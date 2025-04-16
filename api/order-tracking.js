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

    // Search by order name (with '#' prefix), numeric ID, or email
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
    return res.status(500).json({ error: 'Issue connecting to our order system. Please try again later.' });
  }

  // Use a case-insensitive check for fulfillment status.
  const isFulfilled = (shopifyOrder.fulfillment_status || '').toLowerCase() === 'fulfilled';
  
  let isSongReady = false;
  let mp3Link = null;
  
  // Remove any '#' prefix from the Shopify order name and trim spaces.
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
    
    // Assuming your sheet has data in columns A to E (starting from row 2)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Sheet1!A2:E',
    });
    
    const rows = response.data.values || [];
    for (const row of rows) {
      if (row.length >= 5) {
        // Column B should have the Order ID.
        const orderIdFromSheet = (row[1] || "").trim();
        if (orderIdFromSheet === orderName || orderIdFromSheet === query.trim()) {
          // Column E should say "yes" (ignoring case/whitespace) if the song is ready.
          const readyValue = (row[4] || "").trim().toLowerCase();
          isSongReady = (readyValue === "yes");
          // Column D should have the MP3 link (e.g., a Google Drive URL).
          mp3Link = row[3] ? row[3].trim() : null;
          console.log("DEBUG: Matching sheet row for order", orderName, "-> isSongReady:", isSongReady, "mp3Link:", mp3Link);
          break;
        }
      }
    }
  } catch (err) {
    console.error("Google Sheets error:", err);
    // Continue without sheet data if there's an error
  }

  return res.status(200).json({
    isFulfilled,
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
