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

  const queryValue = req.query.query ? req.query.query.trim() : '';
  if (!queryValue) {
    return res.status(400).json({ error: 'Missing order ID or email.' });
  }

  let shopifyOrder = null;
  let customerEmail = "";

  try {
    // Initialize Shopify
    const shopify = new Shopify({
      shopName: process.env.SHOPIFY_STORE,
      accessToken: process.env.SHOPIFY_ADMIN_TOKEN,
    });

    // Step 1: Try exact input as name
    let orders = await shopify.order.list({ name: queryValue, limit: 1 });
    if (orders.length > 0) {
      shopifyOrder = orders[0];
    } else {
      // Step 2: Try adding '#' if not found
      if (!queryValue.startsWith('#')) {
        const altName = `#${queryValue}`;
        const altOrders = await shopify.order.list({ name: altName, limit: 1 });
        if (altOrders.length > 0) {
          shopifyOrder = altOrders[0];
        }
      }
    }

    // Step 3: If STILL not found & query is numeric, try numeric ID
    if (!shopifyOrder && !isNaN(Number(queryValue))) {
      try {
        shopifyOrder = await shopify.order.get(Number(queryValue));
      } catch (numErr) {
        console.log("Numeric ID lookup failed:", numErr.message);
      }
    }

    // Step 4: If STILL not found & query includes '@', search by email
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

    // If no order found, respond with 404
    if (!shopifyOrder) {
      return res.status(404).json({ error: 'Order not found. Please check the order number or email and try again.' });
    }

    // We have a Shopify order
    customerEmail = (shopifyOrder.email || '').trim().toLowerCase();

  } catch (err) {
    console.error("Shopify error:", err);
    return res.status(500).json({ error: 'We encountered an issue connecting to our order system. Please try again later.' });
  }

  // Now read columns A–E from your sheet
  // A => Timestamp
  // B => Order ID (row[1])
  // C => Customer Email (row[2]) (not mandatory)
  // D => MP3 link (row[3])
  // E => "Is the song ready?" => yes/no (row[4])
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

    // Read columns A-E (5 columns) from row 2 onward
    const sheetRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Sheet1!A2:E',
    });
    const rows = sheetRes.data.values || [];

    // Remove leading '#' from Shopify order name for matching
    const orderNameNoHash = shopifyOrder.name.replace(/^#/, '').trim();

    for (const row of rows) {
      if (row.length < 5) continue; // skip incomplete rows

      const sheetOrderId = (row[1] || '').trim(); // Column B = Order ID
      if (sheetOrderId === orderNameNoHash || sheetOrderId === queryValue) {
        // row[3] = Column D => MP3 link
        mp3Link = row[3] || null;
        // row[4] = Column E => "Is the song ready?"
        isSongReady = (row[4] || '').toLowerCase() === 'yes';
        break;
      }
    }
  } catch (sheetErr) {
    console.error("Google Sheets error:", sheetErr);
    // do not fail the request, just proceed
  }

  // Return final JSON
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
