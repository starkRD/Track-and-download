// pages/api/order-tracking.js

import { google } from 'googleapis';
import Shopify from 'shopify-api-node';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Retrieve the query value (Order ID or Email)
  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ error: 'Missing order ID or email.' });
  }
  
  let shopifyOrder = null;
  let customerEmail = "";
  
  try {
    // Initialize Shopify API using environment variables
    const shopify = new Shopify({
      shopName: process.env.SHOPIFY_STORE,
      accessToken: process.env.SHOPIFY_ADMIN_TOKEN,
    });

    // First try: search by order name (adding '#' if necessary)
    const nameQuery = query.startsWith("#") ? query : `#${query}`;
    const ordersByName = await shopify.order.list({ name: nameQuery, limit: 1 });
    
    if (ordersByName.length > 0) {
      shopifyOrder = ordersByName[0];
    } else if (!isNaN(Number(query))) {
      // Second try: if query is numeric then use as an ID
      try {
        shopifyOrder = await shopify.order.get(Number(query));
      } catch (err) {
        console.log("Order ID lookup failed:", err.message);
      }
    }
    
    // Third try: if query contains '@', search by customer email
    if (!shopifyOrder && query.includes('@')) {
      try {
        const ordersByEmail = await shopify.order.list({ email: query.toLowerCase(), limit: 1 });
        if (ordersByEmail.length > 0) {
          shopifyOrder = ordersByEmail[0];
        }
      } catch (err) {
        console.log("Email lookup failed:", err.message);
      }
    }
    
    if (!shopifyOrder) {
      return res.status(404).json({ error: 'Order not found. Please check the order number or email and try again.' });
    }
    
    // Save the registered email from Shopify (if available)
    customerEmail = (shopifyOrder.email || "").trim().toLowerCase();
    
  } catch (err) {
    console.error("Shopify error:", err);
    return res.status(500).json({ error: 'We encountered an issue connecting to our order system. Please try again later.' });
  }
  
  // Query Google Sheet to check song status and fetch download link
  let isSongReady = false;
  let mp3Link = null;
  
  try {
    // Initialize Google Auth using environment variables
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.SHEET_ID;
    
    // Assume the sheet has columns A-F and that:
    // - Column B (index 1) holds the internal order ID (without '#' prefix)
    // - Column D (index 3) holds the MP3 link
    // - Column F (index 5) holds the early access status (e.g., "yes" if song is ready)
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Sheet1!A2:F',
    });
    
    const rows = result.data.values || [];
    // Retrieve the Shopify order's name without the leading '#' for comparison.
    const orderName = shopifyOrder.name.replace('#', '').trim();
    
    // Loop through the rows to find the matching order.
    for (let i = 0; i < rows.length; i++) {
      // Assume the order id is in column B (index 1)
      const sheetOrderId = rows[i][1] ? rows[i][1].trim() : "";
      if (sheetOrderId === orderName || sheetOrderId === query.trim()) {
        // Column F (index 5) indicates if the song is ready ("yes")
        isSongReady = (rows[i][5] || "").toLowerCase() === "yes";
        // Column D (index 3) is assumed to hold the MP3 download link
        mp3Link = rows[i][3] || null;
        break;
      }
    }
  } catch (err) {
    console.error("Google Sheets error:", err);
    // Do not fail the request if sheet access fails; just log the error.
  }
  
  // Return the aggregated result.
  return res.status(200).json({
    isFulfilled: shopifyOrder.fulfillment_status.toLowerCase() === "fulfilled",
    isSongReady, // indicates if the song is uploaded and ready to download
    mp3Link,     // the download link for the song
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
