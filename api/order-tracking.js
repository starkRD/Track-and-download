// pages/api/order-tracking.js
import { google } from 'googleapis';
import Shopify from 'shopify-api-node';

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

    // Try searching order by order name, numeric ID, or email
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

  let isSongReady = false;
  let mp3Link = null;
  
  // Remove the '#' prefix from the Shopify order name if needed
  const orderName = shopifyOrder.name.replace('#', '').trim();

  try {
    // Google Sheets Authentication
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
      range: 'Sheet1!A2:E', // Adjust if your sheet has different layout
    });
    
    const rows = response.data.values || [];
    for (const row of rows) {
      if (row.length >= 5) {
        // row[1] should contain the Order ID from your sheet
        const orderIdFromSheet = (row[1] || "").trim();
        
        // Compare the orderId from sheet with the Shopify order name or query input
        if (orderIdFromSheet === orderName || orderIdFromSheet === query.trim()) {
          // row[4] should contain the flag (e.g., "yes") indicating the song is ready
          const readyValue = (row[4] || "").trim().toLowerCase();
          isSongReady = (readyValue === "yes");
          
          // row[3] should contain the MP3 link
          mp3Link = row[3] ? row[3].trim() : null;
          break;
        }
      }
    }
  } catch (err) {
    console.error("Google Sheets error:", err);
    // Proceed without sheet data if error occurs
  }

  return res.status(200).json({
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
