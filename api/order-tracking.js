// pages/api/order-tracking.js

import { google } from 'googleapis';
import Shopify from 'shopify-api-node';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight OPTIONS request
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
  let customerEmail = '';

  try {
    const shopify = new Shopify({
      shopName: process.env.SHOPIFY_STORE,
      accessToken: process.env.SHOPIFY_ADMIN_TOKEN,
    });

    // STEP 1: Try the exact query as the order name
    let orders = await shopify.order.list({ name: queryValue, limit: 1 });
    if (orders.length > 0) {
      shopifyOrder = orders[0];
    } else {
      // STEP 2: Try adding '#' prefix if not present
      if (!queryValue.startsWith('#')) {
        let altName = `#${queryValue}`;
        orders = await shopify.order.list({ name: altName, limit: 1 });
        if (orders.length > 0) {
          shopifyOrder = orders[0];
        }
      }
    }

    // STEP 3: If not found and query is numeric, try numeric lookup
    if (!shopifyOrder && !isNaN(Number(queryValue))) {
      try {
        shopifyOrder = await shopify.order.get(Number(queryValue));
      } catch (numErr) {
        console.log("Numeric ID lookup failed:", numErr.message);
      }
    }

    // STEP 4: If still not found and query contains '@', try email-based lookup
    if (!shopifyOrder && queryValue.includes('@')) {
      const emailQuery = queryValue.toLowerCase();
      try {
        const ordersByEmail = await shopify.order.list({ email: emailQuery, limit: 1 });
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
    return res.status(500).json({ error: 'We encountered an issue connecting to our order system. Please try again later.' });
  }

  // Next: Check the Google Sheet for song readiness and MP3 link.
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

    // Our sheet columns (A–E):
    // A = Timestamp, B = Order ID, C = Customer Email, D = MP3 Link, E = "Is the song ready?" (yes/no)
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Sheet1!A2:E',
    });
    const rows = result.data.values || [];

    // Remove leading '#' from Shopify order name for comparison
    const orderNameNoHash = shopifyOrder.name.replace(/^#/, '').trim();
    const queryValueNoHash = queryValue.replace(/^#/, '').trim();

    // Debugging: log the values we're searching for
    console.log(`Looking for order match: ${orderNameNoHash} or ${queryValueNoHash}`);
    
    // Improved search logic with better type handling
    for (const row of rows) {
      if (row.length < 5) continue;
      
      const sheetOrderId = (row[1] || '').trim(); // Column B
      const sheetEmail = (row[2] || '').trim().toLowerCase(); // Column C
      
      // Debugging: log values being compared
      console.log(`Sheet data: ID=${sheetOrderId}, Email=${sheetEmail}`);
      
      // Convert to numbers for numeric comparison if possible
      const numericOrderId = !isNaN(parseInt(sheetOrderId)) ? parseInt(sheetOrderId) : null;
      const numericOrderName = !isNaN(parseInt(orderNameNoHash)) ? parseInt(orderNameNoHash) : null;
      
      // Match by order ID with multiple formats and types of comparison
      if (sheetOrderId === orderNameNoHash || 
          sheetOrderId === queryValueNoHash || 
          sheetOrderId === shopifyOrder.name ||
          String(sheetOrderId) === String(orderNameNoHash) ||
          (numericOrderId !== null && numericOrderName !== null && numericOrderId === numericOrderName) ||
          (sheetEmail && sheetEmail === customerEmail.toLowerCase())) {
        
        console.log(`Found match! Song ready: ${row[4]}, MP3: ${row[3]}`);
        mp3Link = row[3] || null;             // Column D
        isSongReady = (row[4] || '').toLowerCase() === 'yes';  // Column E
        break;
      }
    }
    
    // Log the result of our search
    console.log(`Final result: isSongReady=${isSongReady}, mp3Link=${mp3Link ? 'exists' : 'null'}`);
    
  } catch (sheetErr) {
    console.error("Google Sheets error:", sheetErr);
    // We still proceed even if sheet read fails
  }

  // Return aggregated data to the frontend
  return res.status(200).json({
    isFulfilled: (shopifyOrder.fulfillment_status || '').toLowerCase() === 'fulfilled',
    isSongReady, // Directly from sheet
    mp3Link,     // Directly from sheet
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
