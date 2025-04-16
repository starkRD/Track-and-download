// pages/api/order-tracking.js
import { google } from 'googleapis';
import Shopify from 'shopify-api-node';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Handle email verification requests
  if (req.method === 'POST') {
    try {
      const { orderId, verificationEmail } = req.body;
      
      // Validate inputs
      if (!orderId || !verificationEmail) {
        return res.status(400).json({ error: 'Missing order ID or verification email.' });
      }
      
      // Get order details from Shopify
      const shopify = new Shopify({
        shopName: process.env.SHOPIFY_STORE,
        accessToken: process.env.SHOPIFY_ADMIN_TOKEN,
      });
      
      let shopifyOrder = null;
      
      // Try to find order by name
      const nameQuery = orderId.startsWith("#") ? orderId : `#${orderId}`;
      const orders = await shopify.order.list({ name: nameQuery, limit: 1 });
      
      if (orders.length > 0) {
        shopifyOrder = orders[0];
      } else if (!isNaN(Number(orderId))) {
        try {
          shopifyOrder = await shopify.order.get(Number(orderId));
        } catch (idError) {
          console.log("Order ID lookup failed:", idError.message);
        }
      }
      
      if (!shopifyOrder) {
        return res.status(404).json({ error: 'Order not found.' });
      }
      
      // Compare emails
      const customerEmail = (shopifyOrder.email || "").trim().toLowerCase();
      const providedEmail = verificationEmail.trim().toLowerCase();
      
      if (customerEmail !== providedEmail) {
        return res.status(401).json({ error: 'Email verification failed.' });
      }
      
      // Email verified - find song link in sheet
      const mp3Link = await getSongLinkFromSheet(shopifyOrder.name.replace('#', ''));
      
      if (!mp3Link) {
        return res.status(404).json({ error: 'Song not found. It may not be ready yet.' });
      }
      
      return res.status(200).json({
        verified: true,
        mp3Link
      });
    } catch (err) {
      console.error("Email verification error:", err);
      return res.status(500).json({ error: 'Verification failed. Please try again later.' });
    }
  }

  // Handle GET requests (existing order tracking functionality)
  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ error: 'Missing order ID or email.' });
  }

  let shopifyOrder = null;
  let customerEmail = "";
  
  try {
    const shopify = new Shopify({
      shopName: process.env.SHOPIFY_STORE,
      accessToken: process.env.SHOPIFY_ADMIN_TOKEN,
    });

    // Search by order name, numeric ID, or email
    const nameQuery = query.startsWith("#") ? query : `#${query}`;
    const orders = await shopify.order.list({ name: nameQuery, limit: 1 });
    
    if (orders.length > 0) {
      shopifyOrder = orders[0];
    } else if (!isNaN(Number(query))) {
      try {
        shopifyOrder = await shopify.order.get(Number(query));
      } catch (idError) {
        console.log("Order ID lookup failed:", idError.message);
      }
    }
    
    if (!shopifyOrder && query.includes('@')) {
      try {
        const emailOrders = await shopify.order.list({ email: query.toLowerCase(), limit: 1 });
        if (emailOrders.length > 0) {
          shopifyOrder = emailOrders[0];
        }
      } catch (emailError) {
        console.log("Email lookup failed:", emailError.message);
      }
    }

    if (!shopifyOrder) {
      return res.status(404).json({ error: 'Order not found. Please check the order number or email and try again.' });
    }
    
    customerEmail = (shopifyOrder.email || "").trim().toLowerCase();
    
  } catch (err) {
    console.error("Shopify error:", err);
    return res.status(500).json({ error: 'We encountered an issue connecting to our order system. Please try again later.' });
  }

  // Lookup in Google Sheet for song info
  let isSongReady = false;
  let mp3Link = null;
  const orderName = shopifyOrder.name.replace('#', '');
  
  try {
    mp3Link = await getSongLinkFromSheet(orderName);
    isSongReady = !!mp3Link;
  } catch (err) {
    console.error("Google Sheets error:", err);
    // Don't fail the request; just continue with isSongReady=false, mp3Link=null
  }

  // Calculate delivery timeline and expected delivery date
  // We'll assume "5 days" after created_at as the "expected delivery" threshold by default
  const createdAt = new Date(shopifyOrder.created_at);
  const timelineHours = getDeliveryTimeline(shopifyOrder);
  const expectedDeliveryDate = new Date(createdAt.getTime() + timelineHours * 60 * 60 * 1000);

  // Get current status based on time calculations
  const now = new Date();
  let statusOverride = "";

  // Check if delivery date has passed
  const deliveryDatePassed = now > expectedDeliveryDate;
  
  // 1) If fulfilled:
  if (shopifyOrder.fulfillment_status === "fulfilled") {
    if (isSongReady && mp3Link) {
      // Provide link, but only after email verification in front end
      statusOverride = "Fulfilled + SongReady";
    } else {
      // Show "Delivered" if the sheet doesn't have the link
      statusOverride = "Delivered";
    }
  }
  // 2) Else if expected delivery date has passed:
  else if (deliveryDatePassed) {
    if (isSongReady && mp3Link) {
      statusOverride = "Song ready";
    } else {
      // Show "Song ready" even if it's not in the sheet, as requested
      statusOverride = "Song ready";
    }
  }
  // Otherwise fallback
  else {
    // fallback to the normal Shopify fulfillment status or "unfulfilled"
    statusOverride = shopifyOrder.fulfillment_status || "unfulfilled";
  }

  // Mask the email (show first character and domain part)
  let maskedEmail = "";
  if (customerEmail) {
    const atIndex = customerEmail.indexOf('@');
    if (atIndex > 0) {
      maskedEmail = customerEmail.charAt(0) + 
                    '*'.repeat(atIndex - 1) + 
                    customerEmail.substring(atIndex);
    }
  }

  // Return data
  return res.status(200).json({
    isFulfilled: shopifyOrder.fulfillment_status === "fulfilled",
    isSongReady,
    mp3Link: null, // Don't send the direct link until email verification
    emailFromShopify: maskedEmail, // Send masked email
    canDownload: (deliveryDatePassed || shopifyOrder.fulfillment_status === "fulfilled") && isSongReady,
    order: {
      name: shopifyOrder.name,
      id: shopifyOrder.id,
      created_at: shopifyOrder.created_at,
      fulfillment_status: shopifyOrder.fulfillment_status,
      email: maskedEmail,
      line_items: shopifyOrder.line_items.map(i => ({ variant_id: i.variant_id })),
    },
    expectedDeliveryDate: expectedDeliveryDate.toISOString(),
    deliveryDatePassed,
    statusOverride
  });
}

// Helper function to get delivery timeline from variant IDs
function getDeliveryTimeline(order) {
  const variantTimelines = [
    { ids: ["41290369269835"], hours: 240 }, // Basic: 10 days
    { ids: ["41290369302603", "41274164510795"], hours: 120 }, // Standard: 5 days
    { ids: ["41290369335371"], hours: 30 }, // Premium: 30 hours
    { ids: ["41290369368139"], hours: 30 }, // Beast: 30 hours
    { ids: ["41274164543563"], hours: 48 }, // FAST: 48 hours
    { ids: ["41274164576331"], hours: 24 } // EXPRESS: 24 hours
  ];

  let matchedHours = [];
  if (order.line_items && order.line_items.length > 0) {
    order.line_items.forEach(item => {
      let variantId = String(item.variant_id);
      variantTimelines.forEach(variant => {
        if (variant.ids.includes(variantId)) {
          matchedHours.push(variant.hours);
        }
      });
    });
  }
  
  if (matchedHours.length > 0) {
    return Math.min(...matchedHours);
  }
  return 240; // Default to 10 days
}

// Helper function to get song link from sheet
async function getSongLinkFromSheet(orderName) {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  
  const sheets = google.sheets({ version: 'v4', auth });
  const sheetId = process.env.SHEET_ID;
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Sheet1!A2:E',
  });
  
  const rows = response.data.values || [];
  for (const row of rows) {
    if (row.length >= 5) {
      const orderId = (row[1] || "").trim();
      if (orderId === orderName) {
        const isSongReady = (row[4] || "").toLowerCase() === "yes";
        if (isSongReady) {
          return row[3] || null; // Return the MP3 link
        }
        break;
      }
    }
  }
  
  return null;
}
