// pages/api/order-tracking.js
import { google } from 'googleapis';
import Shopify from 'shopify-api-node';

// Placeholder for email verification logic.
async function isEmailVerified(email) {
  // Replace with your actual verification mechanism.
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

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

  // Look up the song status in the Google Sheet
  let isSongReady = false;
  let mp3Link = null;
  const orderName = shopifyOrder.name.replace('#', '');
  
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.SHEET_ID;
    
    // Assume Sheet1: column B holds order IDs, column D holds download links, and column E has the readiness flag.
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Sheet1!A2:E',
    });
    
    const rows = response.data.values || [];
    for (const row of rows) {
      if (row.length >= 5) {
        const orderId = (row[1] || "").trim();
        if (orderId === orderName || orderId === query.trim()) {
          isSongReady = (row[4] || "").toLowerCase() === "yes";
          mp3Link = row[3] || null;
          break;
        }
      }
    }
  } catch (err) {
    console.error("Google Sheets error:", err);
  }

  // Determine the appropriate status message.
  let statusMessage = "";
  const currentDate = new Date();
  let expectedDeliveryDate = new Date(shopifyOrder.created_at);
  // For example, assume expected delivery is 5 days after order creation. Adjust if needed.
  expectedDeliveryDate.setDate(expectedDeliveryDate.getDate() + 5);

  // Case 1: Order is fulfilled.
  if (shopifyOrder.fulfillment_status === "fulfilled") {
    if (mp3Link && isSongReady) {
      if (await isEmailVerified(customerEmail)) {
        statusMessage = "Song ready. Download available.";
      } else {
        statusMessage = "Song ready but email not verified. Please verify your email to download.";
        mp3Link = null; // Do not show download link.
      }
    } else {
      statusMessage = "Delivered";
    }
  }
  // Case 2: Expected delivery date passed.
  else if (currentDate > expectedDeliveryDate) {
    if (mp3Link && isSongReady) {
      if (await isEmailVerified(customerEmail)) {
        statusMessage = "Song ready. Download available.";
      } else {
        statusMessage = "Song ready but email not verified. Please verify your email to download.";
        mp3Link = null;
      }
    } else {
      statusMessage = "Song ready";
    }
  }
  else {
    // Fallback to Shopify's fulfillment status if none of the above apply.
    statusMessage = shopifyOrder.fulfillment_status;
  }

  return res.status(200).json({
    statusMessage,
    isFulfilled: shopifyOrder.fulfillment_status === "fulfilled",
    isSongReady,
    mp3Link,
    emailFromShopify: customerEmail,
    order: {
      name: shopifyOrder.name,
      id: shopifyOrder.id,
      created_at: shopifyOrder.created_at,
      fulfillment_status: shopifyOrder.fulfillment_status,
      email: customerEmail,
      line_items: shopifyOrder.line_items.map(i => ({ variant_id: i.variant_id })),
    }
  });
}

