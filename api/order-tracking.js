// pages/api/order-tracking.js

import { google } from 'googleapis';
import Shopify from 'shopify-api-node';

export default async function handler(req, res) {
  // CORS and preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // The ?query= param
  const queryValue = req.query.query ? req.query.query.trim() : '';
  if (!queryValue) {
    return res.status(400).json({ error: 'Missing order ID or email.' });
  }

  let shopifyOrder = null;
  let customerEmail = '';

  try {
    // Initialize Shopify
    const shopify = new Shopify({
      shopName: process.env.SHOPIFY_STORE,
      accessToken: process.env.SHOPIFY_ADMIN_TOKEN,
    });

    // 1) Try the exact user input as the name
    let orders = await shopify.order.list({ name: queryValue, limit: 1 });
    if (orders.length > 0) {
      shopifyOrder = orders[0];
    } else {
      // 2) If not found, try adding "#" prefix
      if (!queryValue.startsWith('#')) {
        const altName = `#${queryValue}`;
        const altOrders = await shopify.order.list({ name: altName, limit: 1 });
        if (altOrders.length > 0) {
          shopifyOrder = altOrders[0];
        }
      }
    }

    // 3) If STILL not found, and query is numeric, try numeric ID
    if (!shopifyOrder && !isNaN(Number(queryValue))) {
      try {
        shopifyOrder = await shopify.order.get(Number(queryValue));
      } catch (numErr) {
        console.log("Numeric ID lookup failed:", numErr.message);
      }
    }

    // 4) If STILL not found and includes '@', try email
    if (!shopifyOrder && queryValue.includes('@')) {
      try {
        const emailOrders = await shopify.order.list({ email: queryValue.toLowerCase(), limit: 1 });
        if (emailOrders.length > 0) {
          shopifyOrder = emailOrders[0];
        }
      } catch (emailErr) {
        console.log("Email-based lookup failed:", emailErr.message);
      }
    }

    // If we STILL don't have an order, respond 404
    if (!shopifyOrder) {
      return res.status(404).json({ error: 'Order not found. Please check the order number or email and try again.' });
    }

    // Save the customer email
    customerEmail = (shopifyOrder.email || '').trim().toLowerCase();

  } catch (shopifyErr) {
    console.error("Shopify error:", shopifyErr);
    return res.status(500).json({ error: 'We encountered an issue connecting to our order system. Please try again later.' });
  }

  // Next, Google Sheets check
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

    // Suppose your sheet has 5 columns: A-E
    // A => Timestamp
    // B => Order ID (row[1])
    // C => Customer Email? (row[2])
    // D => MP3 link? (row[3])
    // E => "Is the song ready?" => yes/no => (row[4])
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Sheet1!A2:E',
    });
    const rows = result.data.values || [];

    // Remove leading '#' from order name to match what's in the sheet
    const orderNameNoHash = shopifyOrder.name.replace(/^#/, '').trim();

    for (const row of rows) {
      // Each row is an array of up to 5 columns
      if (row.length < 5) continue;
      
      const sheetOrderId = (row[1] || '').trim(); // col B
      if (sheetOrderId === orderNameNoHash || sheetOrderId === queryValue) {
        // row[3] => column D => mp3 link
        mp3Link = row[3] || null;
        // row[4] => column E => "yes" if ready
        isSongReady = (row[4] || '').toLowerCase() === 'yes';
        break;
      }
    }
  } catch (sheetErr) {
    console.error("Google Sheets error:", sheetErr);
    // do not fail the entire request
  }

  // Return all combined data
  return res.status(200).json({
    // If the Shopify order says "fulfilled", we pass it here
    isFulfilled: (shopifyOrder.fulfillment_status || '').toLowerCase() === 'fulfilled',
    // If the sheet says "yes", then the song is ready
    isSongReady,
    // Link from the sheet
    mp3Link,
    // The user’s email from Shopify
    emailFromShopify: customerEmail,
    // Minimal order info
    order: {
      name: shopifyOrder.name,  // e.g. "#4143"
      id: shopifyOrder.id,
      created_at: shopifyOrder.created_at,
      fulfillment_status: shopifyOrder.fulfillment_status,
      email: customerEmail,
      line_items: shopifyOrder.line_items.map(i => ({ variant_id: i.variant_id })),
    }
  });
}
