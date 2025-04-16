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

  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ error: 'Missing order ID or email.' });
  }

  let shopifyOrder = null;
  let customerEmail = "";

  try {
    // Initialize Shopify API via environment variables
    const shopify = new Shopify({
      shopName: process.env.SHOPIFY_STORE,
      accessToken: process.env.SHOPIFY_ADMIN_TOKEN,
    });

    // 1) Try EXACT user input as the order name
    let ordersByName = await shopify.order.list({ name: query, limit: 1 });
    if (ordersByName.length > 0) {
      shopifyOrder = ordersByName[0];
    } else {
      // 2) If not found, try adding '#' prefix
      const altNameQuery = query.startsWith('#') ? query : `#${query}`;
      const altOrders = await shopify.order.list({ name: altNameQuery, limit: 1 });
      if (altOrders.length > 0) {
        shopifyOrder = altOrders[0];
      }
    }

    // 3) Optionally, if STILL not found and the query is numeric, try numeric ID
    if (!shopifyOrder && !isNaN(Number(query))) {
      try {
        shopifyOrder = await shopify.order.get(Number(query));
      } catch (idErr) {
        console.log("Order ID numeric lookup failed:", idErr.message);
      }
    }

    // 4) Email-based search if STILL not found and query includes '@'
    if (!shopifyOrder && query.includes('@')) {
      try {
        const emailOrders = await shopify.order.list({ email: query.toLowerCase(), limit: 1 });
        if (emailOrders.length > 0) {
          shopifyOrder = emailOrders[0];
        }
      } catch (emailError) {
        console.log("Email-based lookup failed:", emailError.message);
      }
    }

    // If after all attempts, we didn't find the order, respond with 404
    if (!shopifyOrder) {
      return res.status(404).json({ error: 'Order not found. Please check the order number or email and try again.' });
    }

    // We have a Shopify order now
    customerEmail = (shopifyOrder.email || "").trim().toLowerCase();

  } catch (err) {
    console.error("Shopify error:", err);
    return res.status(500).json({ error: 'We encountered an issue connecting to our order system. Please try again later.' });
  }

  // Next, check the Google Sheet for the song status (isSongReady) and mp3Link
  let isSongReady = false;
  let mp3Link = null;

  try {
    // Initialize Google auth
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.SHEET_ID;

    // We read columns A–F (adjust if your data is located elsewhere)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Sheet1!A2:F',
    });

    const rows = response.data.values || [];

    // Remove leading '#' from the Shopify order name for matching
    const orderName = shopifyOrder.name.replace('#', '').trim();

    for (const row of rows) {
      // row[1] is column B, which we assume stores the internal order ID
      const sheetOrderId = (row[1] || "").trim();
      // row[3] is column D for the mp3 link
      // row[5] is column F for "yes" if the song is ready

      if (sheetOrderId === orderName || sheetOrderId === query.trim()) {
        isSongReady = (row[5] || "").toLowerCase() === "yes";
        mp3Link = row[3] || null;
        break;
      }
    }
  } catch (err) {
    console.error("Google Sheets error:", err);
    // We won't fail the request if Sheets fails; just log error.
  }

  // Finally, return our result JSON
  return res.status(200).json({
    isFulfilled: (shopifyOrder.fulfillment_status || "").toLowerCase() === "fulfilled",
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
