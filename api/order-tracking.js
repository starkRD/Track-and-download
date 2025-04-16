// pages/api/order-tracking.js

import { google } from 'googleapis';
import Shopify from 'shopify-api-node';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Get the query value from ?query=
  const queryValue = req.query.query ? req.query.query.trim() : '';
  if (!queryValue) {
    return res.status(400).json({ error: 'Missing order ID or email.' });
  }

  let shopifyOrder = null;
  let customerEmail = '';

  try {
    // Initialize Shopify with your store info
    const shopify = new Shopify({
      shopName: process.env.SHOPIFY_STORE,
      accessToken: process.env.SHOPIFY_ADMIN_TOKEN,
    });

    // STEP 1: Try exact query as order name
    let orders = await shopify.order.list({ name: queryValue, limit: 1 });
    if (orders.length > 0) {
      shopifyOrder = orders[0];
    } else {
      // STEP 2: Try adding '#' prefix if not present
      if (!queryValue.startsWith('#')) {
        const altName = `#${queryValue}`;
        orders = await shopify.order.list({ name: altName, limit: 1 });
        if (orders.length > 0) {
          shopifyOrder = orders[0];
        }
      }
    }

    // STEP 3: If still not found and the query is numeric, try numeric ID lookup
    if (!shopifyOrder && !isNaN(Number(queryValue))) {
      try {
        shopifyOrder = await shopify.order.get(Number(queryValue));
      } catch (numErr) {
        console.log("Numeric ID lookup failed:", numErr.message);
      }
    }

    // STEP 4: If still not found and the query contains '@', try email lookup
    if (!shopifyOrder && queryValue.includes('@')) {
      try {
        const ordersByEmail = await shopify.order.list({ email: queryValue.toLowerCase(), limit: 1 });
        if (ordersByEmail.length > 0) {
          shopifyOrder = ordersByEmail[0];
        }
      } catch (emailErr) {
        console.log("Email-based lookup failed:", emailErr.message);
      }
    }

    if (!shopifyOrder) {
      return res.status(404).json({ error: 'Order not found. Please check the order number or email and try again.' });
    }
    customerEmail = (shopifyOrder.email || '').trim().toLowerCase();

  } catch (shopifyErr) {
    console.error("Shopify error:", shopifyErr);
    return res.status(500).json({ error: 'Error connecting to our order system. Please try again later.' });
  }

  // Google Sheets lookup
  let isSongReady = false;
  let mp3Link = null;
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
    // Our Sheet: Columns A: Timestamp, B: Order ID, C: Customer Email, D: MP3 Link, E: Song Ready flag
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Sheet1!A2:E',
    });
    const rows = result.data.values || [];

    // Remove leading '#' from Shopify order name for matching
    const orderNameNoHash = shopifyOrder.name.replace(/^#/, '').trim();

    for (const row of rows) {
      if (row.length < 5) continue;
      const sheetOrderId = (row[1] || '').trim(); // Column B
      if (sheetOrderId === orderNameNoHash || sheetOrderId === queryValue) {
        mp3Link = row[3] || null;                      // Column D
        isSongReady = (row[4] || '').trim().toLowerCase() === 'yes'; // Column E
        break;
      }
    }
  } catch (sheetErr) {
    console.error("Google Sheets error:", sheetErr);
  }

  return res.status(200).json({
    isFulfilled: (shopifyOrder.fulfillment_status || '').toLowerCase() === 'fulfilled',
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
