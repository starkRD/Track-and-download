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

  // Try fetching the order from Shopify
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
      // STEP 2: Try adding '#' prefix (if user input lacks it)
      if (!queryValue.startsWith('#')) {
        const altName = `#${queryValue}`;
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
    // (Optional: keep for safety but note that matching in the sheet will be based on order ID)
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
      return res.status(404).json({ error: 'Order not found. Please check the order number and try again.' });
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
    // Set up Google Sheets access
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

    // Normalize Shopify order name by removing the '#' (if any)
    const orderNameNoHash = shopifyOrder.name.replace(/^#/, '').trim();
    // Also normalize the query value (if user entered "#4134" vs "4134")
    const queryValueNoHash = queryValue.replace(/^#/, '').trim();

    console.log(`Looking for order match: ${orderNameNoHash} or ${queryValueNoHash}`);

    // Look up the record solely by comparing the order ID from Shopify (numeric only) with sheet Column B
    for (const row of rows) {
      if (row.length < 5) continue;

      const sheetOrderId = (row[1] || '').trim(); // Value in Column B should be something like "4134"
      // Convert to numbers (if possible) for comparison
      const numericSheetOrderId = !isNaN(parseInt(sheetOrderId)) ? parseInt(sheetOrderId, 10) : null;
      const numericOrderId = !isNaN(parseInt(orderNameNoHash)) ? parseInt(orderNameNoHash, 10) : null;

      if (
        sheetOrderId === orderNameNoHash ||
        sheetOrderId === queryValueNoHash ||
        (numericSheetOrderId !== null && numericOrderId !== null && numericSheetOrderId === numericOrderId)
      ) {
        console.log(`Found match! Song ready: ${row[4]}, MP3: ${row[3]}`);
        mp3Link = row[3] || null; // Column D holds the MP3 link
        isSongReady = (row[4] || '').trim().toLowerCase() === 'yes'; // Column E should be "yes" or "no"
        break;
      }
    }
    console.log(`Final result: isSongReady=${isSongReady}, mp3Link=${mp3Link ? 'exists' : 'null'}`);

  } catch (sheetErr) {
    console.error("Google Sheets error:", sheetErr);
    // Proceed even if sheet lookup fails
  }

  // Return the aggregated order data along with song readiness and MP3 link
  return res.status(200).json({
    isFulfilled: (shopifyOrder.fulfillment_status || '').toLowerCase() === 'fulfilled',
    isSongReady, // Derived from the sheet
    mp3Link,     // Derived from the sheet
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
