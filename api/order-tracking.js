// api/order-tracking.js

import { google } from 'googleapis';
import Shopify from 'shopify-api-node';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1) Validate query param
  const query = (req.query.query || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'Missing order ID or email.' });
  }

  let shopifyOrder = null;
  let customerEmail = '';
  let lookupMethod = 'none';

  try {
    const shopify = new Shopify({
      shopName: process.env.SHOPIFY_STORE,
      accessToken: process.env.SHOPIFY_ADMIN_TOKEN,
    });

    // 2) Try lookup by order name with status:any
    const nameQuery = query.startsWith('#') ? query : `#${query}`;
    console.log('🔍 Trying name lookup (status:any):', nameQuery);
    const ordersByName = await shopify.order.list({
      name: nameQuery,
      status: 'any',
      limit: 1
    });
    if (ordersByName.length > 0) {
      shopifyOrder = ordersByName[0];
      lookupMethod = 'order.name';
    }

    // 3) Fallback: lookup by numeric ID
    if (!shopifyOrder && !isNaN(Number(query))) {
      try {
        console.log('🔍 Trying ID lookup:', query);
        shopifyOrder = await shopify.order.get(Number(query));
        lookupMethod = 'order.id';
      } catch (errId) {
        console.log('❌ Order ID lookup failed:', errId.message);
      }
    }

    // 4) Fallback: lookup by email with status:any
    if (!shopifyOrder && query.includes('@')) {
      try {
        console.log('🔍 Trying email lookup (status:any):', query);
        const ordersByEmail = await shopify.order.list({
          email: query.toLowerCase(),
          status: 'any',
          limit: 1
        });
        if (ordersByEmail.length > 0) {
          shopifyOrder = ordersByEmail[0];
          lookupMethod = 'order.email';
        }
      } catch (errEmail) {
        console.log('❌ Email lookup failed:', errEmail.message);
      }
    }

    if (!shopifyOrder) {
      return res.status(404).json({
        error: 'Order not found. Please check the order number or email and try again.'
      });
    }

    customerEmail = (shopifyOrder.email || '').trim().toLowerCase();
  } catch (err) {
    console.error('Shopify error:', err);
    return res.status(500).json({ error: 'Error accessing Shopify API.' });
  }

  // 5) Determine if fulfilled
  const isFulfilled = (shopifyOrder.fulfillment_status || '')
    .toLowerCase() === 'fulfilled';

  // 6) Read Google Sheet for song links
  const orderNameNormalized = shopifyOrder.name.replace('#', '').trim();
  let songs = [];

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const sheetRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: 'Sheet1!A2:Z'
    });
    const rows = sheetRes.data.values || [];

    for (const row of rows) {
      const sheetOrderId = (row[1] || '').replace('#', '').trim();
      const readyFlag   = (row[4] || '').trim().toLowerCase();
      const uploadCell  = (row[3] || '').trim();

      if (
        (sheetOrderId === orderNameNormalized || sheetOrderId === query) &&
        readyFlag === 'yes'
      ) {
        // split comma or newline separated URLs
        songs = uploadCell
          .split(/[\n,]+/)
          .map(link => link.trim())
          .filter(link => link);
        console.log('✅ Sheet match for', sheetOrderId, '→ songs:', songs);
        break;
      }
    }
  } catch (err) {
    console.error('Google Sheets error:', err);
  }

  // 7) Respond with all data
  return res.status(200).json({
    isFulfilled,
    songs,
    emailFromShopify: customerEmail,
    lookupMethod,
    order: {
      name: shopifyOrder.name,
      id: shopifyOrder.id,
      created_at: shopifyOrder.created_at,
      fulfillment_status: shopifyOrder.fulfillment_status,
      email: customerEmail,
      line_items: shopifyOrder.line_items.map(i => ({ variant_id: i.variant_id }))
    }
  });
}
