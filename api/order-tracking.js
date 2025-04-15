import { google } from 'googleapis';
import Shopify from 'shopify-api-node';

// Placeholder function for email verification.
async function isEmailVerified(email) {
  // Replace with your actual email verification logic.
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
    
    // --- NOTE ---
    // Many stores use order names with or without the leading "#".
    // If your Shopify orders are stored *without* a "#", use the query as is.
    // Adjust this line based on what your orders look like!
    const nameQuery = query; // Use query as-is (remove automatic "#")
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

  // Look up the song record in the Google Sheet.
  let isSongReady = false;
  let mp3Link = null;
  // Remove the "#" in shopify order name so you compare plain numbers/strings.
  const orderName = shopifyOrder.name.replace('#', '').trim();

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
    
    // Adjust the range if your layout is different.
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Sheet1!A2:E',
    });
    
    const rows = response.data.values || [];
    for (const row of rows) {
      if (row.length >= 5) {
        // Assuming column B (row[1]) holds the order ID without a "#"
        const sheetOrderId = (row[1] || "").trim();
        if (sheetOrderId === orderName || sheetOrderId === query.trim()) {
          // Column E (row[4]) should be "yes" if the song is ready.
          isSongReady = (row[4] || "").toLowerCase() === "yes";
          // Column D (row[3]) has the download link.
          mp3Link = row[3] || null;
          break;
        }
      }
    }
  } catch (err) {
    console.error("Google Sheets error:", err);
  }

  // Calculate expected delivery date (example: 5 days after order creation)
  let expectedDeliveryDate = new Date(shopifyOrder.created_at);
  expectedDeliveryDate.setDate(expectedDeliveryDate.getDate() + 5);
  const currentDate = new Date();

  // Determine the final status message based on the following logic:
  // 1) For fulfilled orders:
  //    - If a matching sheet record exists with song ready, return the download link (if email verified)
  //    - Otherwise, show "Delivered"
  // 2) If the expected delivery date has passed:
  //    - If a matching record exists with the song ready, return download link (if email verified)
  //    - Else, show "Song ready"
  let statusMessage = "";

  if (shopifyOrder.fulfillment_status === "fulfilled") {
    if (mp3Link && isSongReady) {
      if (await isEmailVerified(customerEmail)) {
        statusMessage = "Song ready. Download available.";
      } else {
        statusMessage = "Song ready but email not verified. Please verify your email to download.";
        mp3Link = null;
      }
    } else {
      statusMessage = "Delivered";
    }
  } else if (currentDate > expectedDeliveryDate) {
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
  } else {
    // Fallback: if the order isn’t fulfilled and the delivery date isn’t passed.
    statusMessage = shopifyOrder.fulfillment_status || "unfulfilled";
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
