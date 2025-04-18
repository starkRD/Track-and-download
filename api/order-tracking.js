// api/order-tracking.js

const { google } = require('googleapis');
const Shopify = require('shopify-api-node');

module.exports = async function handler(req, res) {
  // 1) CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = (req.query.query || '').trim();
  if (!query) return res.status(400).json({ error: 'Missing order ID or email.' });

  let shopifyOrder = null;
  let customerEmail = '';

  try {
    const shopify = new Shopify({
      shopName: process.env.SHOPIFY_STORE,
      accessToken: process.env.SHOPIFY_ADMIN_TOKEN,
    });

    const nameQuery = query.startsWith('#') ? query : `#${query}`;
    const byName = await shopify.order.list({ name: nameQuery, status: 'any', limit: 1 });
    if (byName.length) shopifyOrder = byName[0];

    if (!shopifyOrder && !isNaN(Number(query))) {
      try { shopifyOrder = await shopify.order.get(Number(query)); } catch {}
    }

    if (!shopifyOrder && query.includes('@')) {
      const byEmail = await shopify.order.list({ email: query.toLowerCase(), status: 'any', limit: 1 });
      if (byEmail.length) shopifyOrder = byEmail[0];
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

  const isFulfilled = (shopifyOrder.fulfillment_status || '').toLowerCase() === 'fulfilled';
  const orderKey = shopifyOrder.name.replace('#','').trim();

  let songs = [], isPaid = false;
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const sheetRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: 'Sheet1!A2:Z'
    });
    const rows = sheetRes.data.values || [];

    for (const row of rows) {
      const sid   = (row[1]||'').replace('#','').trim();     // Column B = order ID
      const urls  = (row[3]||'').trim();                     // Column D = song links
      const ready = (row[4]||'').trim().toLowerCase();       // Column E = song ready
      const paid  = (row[5]||'').trim().toLowerCase();       // Column F = early access paid

      if ((sid === orderKey || sid === query) && ready === 'yes' && urls) {
        songs = urls.split(/[\n,]+/).map(u => u.trim()).filter(Boolean);
        isPaid = (paid === 'yes');
        break;
      }
    }
  } catch (err) {
    console.error('Google Sheets error:', err);
  }

  return res.status(200).json({
    isFulfilled,
    songs,
    earlyAccessPaid: isPaid,
    emailFromShopify: customerEmail,
    order: {
      name: shopifyOrder.name,
      id: shopifyOrder.id,
      created_at: shopifyOrder.created_at,
      fulfillment_status: shopifyOrder.fulfillment_status,
      email: customerEmail,
      line_items: shopifyOrder.line_items.map(i => ({ variant_id: i.variant_id }))
    }
  });
};
