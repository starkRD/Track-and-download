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
    return res.status(400).json({ error: 'Missing order ID.' });
  }

  let shopifyOrder = null;
  let customerEmail = '';

  try {
    const shopify = new Shopify({
      shopName: process.env.SHOPIFY_STORE,
      accessToken: process.env.SHOPIFY_ADMIN_TOKEN,
    });

    // STEP 1: Try exact query as the order name
    let orders = await shopify.order.list({ name: queryValue, limit: 1 });
    if (orders.length > 0) {
      shopifyOrder = orders[0];
    } else {
      // STEP 2: Try adding '#' prefix if needed
      if (!queryValue.startsWith('#')) {
        const altName = `#${queryValue}`;
        orders = await shopify.order.list({ name: altName, limit: 1 });
        if (orders.length > 0) {
          shopifyOrder = orders[0];
        }
      }
    }

    // STEP 3: Try numeric lookup if still not found
    if (!shopifyOrder && !isNaN(Number(queryValue))) {
      try {
        shopifyOrder = await shopify.order.get(Number(queryValue));
      } catch (numErr) {
        console.log("Numeric ID lookup failed:", numErr.message);
      }
    }

    if (!shopifyOrder) {
      return res.status(404).json({ error: 'Order not found. Please check the order number and try again.' });
    }

    customerEmail = (shopifyOrder.email || '').trim().toLowerCase();
  } catch (shopifyErr) {
    console.error("Shopify error:", shopifyErr);
    return res.status(500).json({ error: 'Error connecting to our order system. Please try again later.' });
  }

  // Check Google Sheet for song readiness and MP3 link.
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

    // Sheet columns:
    // A = Timestamp, B = Order ID, C = Customer Email, D = MP3 Link, E = "Is the song ready?" (yes/no)
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Sheet1!A2:E',
    });
    const rows = result.data.values || [];

    // Normalize Shopify order name to remove '#' and trim spaces.
    const orderNameNoHash = shopifyOrder.name.replace(/^#/, '').trim();
    const queryValueNoHash = queryValue.replace(/^#/, '').trim();

    // Loop through rows to match based solely on Order ID (numeric only)
    for (const row of rows) {
      if (row.length < 5) continue;

      const sheetOrderId = (row[1] || '').trim();  // Column B
      const numericSheetOrderId = !isNaN(parseInt(sheetOrderId, 10)) ? parseInt(sheetOrderId, 10) : null;
      const numericOrderId = !isNaN(parseInt(orderNameNoHash, 10)) ? parseInt(orderNameNoHash, 10) : null;

      if (
        sheetOrderId === orderNameNoHash ||
        sheetOrderId === queryValueNoHash ||
        (numericSheetOrderId !== null && numericOrderId !== null && numericSheetOrderId === numericOrderId)
      ) {
        console.log(`Found match for Order ${sheetOrderId}: Song Ready=${row[4]}, MP3 Link=${row[3]}`);
        mp3Link = row[3] || null; // Column D

        // Convert the cell value to a string to avoid issues if it is a boolean or other type.
        isSongReady = String(row[4] || '').trim().toLowerCase() === 'yes';
        break;
      }
    }
    console.log(`Final result: isSongReady=${isSongReady}, mp3Link=${mp3Link ? 'exists' : 'null'}`);
  } catch (sheetErr) {
    console.error("Google Sheets error:", sheetErr);
    // Proceed even if sheet lookup fails.
  }

  return res.status(200).json({
    isFulfilled: (shopifyOrder.fulfillment_status || '').toLowerCase() === 'fulfilled',
    isSongReady, // Based on the sheet data
    mp3Link,     // Based on the sheet data
    emailFromShopify: customerEmail,
    order: {
      name: shopifyOrder.name,
      id: shopifyOrder.id,
      created_at: shopifyOrder.created_at,
      fulfillment_status: shopifyOrder.fulfillment_status,
      email: customerEmail,
      line_items: shopifyOrder.line_items.map(i => ({ variant_id: i.variant_id })),
    },
  });
}
