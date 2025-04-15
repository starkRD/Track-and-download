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
  
  console.log("Query from client:", query);

  let shopifyOrder = null;
  let customerEmail = "";
  
  try {
    const shopify = new Shopify({
      shopName: process.env.SHOPIFY_STORE,
      accessToken: process.env.SHOPIFY_ADMIN_TOKEN,
    });
    
    // DEBUG: Remove hash addition temporarily if unsure of format.
    const nameQuery = query; // Was: query.startsWith("#") ? query : `#${query}`;
    console.log("Searching Shopify with nameQuery:", nameQuery);

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
      console.log("No order found for query:", query);
      return res.status(404).json({ error: 'Order not found. Please check the order number or email and try again.' });
    }
    
    customerEmail = (shopifyOrder.email || "").trim().toLowerCase();
    console.log("Found Shopify order:", shopifyOrder);

  } catch (err) {
    console.error("Shopify error:", err);
    return res.status(500).json({ error: 'We encountered an issue connecting to our order system. Please try again later.' });
  }

  // Look up the song status in the Google Sheet
  let isSongReady = false;
  let mp3Link = null;
  // Remove hash for comparison if needed.
  const orderName = shopifyOrder.name.replace('#', '').trim();
  console.log("Normalized Shopify order name:", orderName);
  
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
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Sheet1!A2:E',
    });
    
    const rows = response.data.values || [];
    console.log("Sheet rows:", rows);
    for (const row of rows) {
      if (row.length >= 5) {
        const orderIdSheet = (row[1] || "").trim();
        console.log("Checking sheet orderId:", orderIdSheet, "against", orderName, "and", query.trim());
        if (orderIdSheet === orderName || orderIdSheet === query.trim()) {
          isSongReady = (row[4] || "").toLowerCase() === "yes";
          mp3Link = row[3] || null;
          console.log("Match found. isSongReady:", isSongReady, "mp3Link:", mp3Link);
          break;
        }
      }
    }
  } catch (err) {
    console.error("Google Sheets error:", err);
  }
  
  // Calculate expected delivery date (assumed 5 days after order creation)
  let statusMessage = "";
  const currentDate = new Date();
  let expectedDeliveryDate = new Date(shopifyOrder.created_at);
  expectedDeliveryDate.setDate(expectedDeliveryDate.getDate() + 5);

  // Determine status based on Shopify data and sheet record
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
    statusMessage = shopifyOrder.fulfillment_status || "unfulfilled";
  }

  console.log("Final statusMessage:", statusMessage);

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
