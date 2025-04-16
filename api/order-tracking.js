import { google } from 'googleapis';
import Shopify from 'shopify-api-node';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ error: 'Missing order ID or email.' });
  }

  let shopifyOrder = null;
  let customerEmail = "";
  let lookupMethod = "none";

  try {
    const shopify = new Shopify({
      shopName: process.env.SHOPIFY_STORE,
      accessToken: process.env.SHOPIFY_ADMIN_TOKEN,
    });

    // ✅ 1) Name-based lookup with status: 'any'
    const nameQuery = query.startsWith("#") ? query : `#${query}`;
    console.log("🔍 Trying name lookup (status:any):", nameQuery);
    const orders = await shopify.order.list({
      name: nameQuery,
      status: 'any', // <-- ensures old & fulfilled orders are included
      limit: 1
    });
    if (orders.length > 0) {
      shopifyOrder = orders[0];
      lookupMethod = "order.name";
    }

    // ✅ 2) Fallback: If '4170' was actually the numeric ID "6021311234123"
    if (!shopifyOrder && !isNaN(Number(query))) {
      try {
        console.log("🔍 Trying ID lookup:", query);
        shopifyOrder = await shopify.order.get(Number(query));
        lookupMethod = "order.id";
      } catch (idError) {
        console.log("❌ Order ID lookup failed:", idError.message);
      }
    }

    // ✅ 3) Fallback: Email-based lookup with status: 'any'
    if (!shopifyOrder && query.includes('@')) {
      try {
        console.log("🔍 Trying email lookup (status:any):", query);
        const emailOrders = await shopify.order.list({
          email: query.toLowerCase(),
          status: 'any',
          limit: 1
        });
        if (emailOrders.length > 0) {
          shopifyOrder = emailOrders[0];
          lookupMethod = "order.email";
        }
      } catch (emailError) {
        console.log("❌ Email lookup failed:", emailError.message);
      }
    }

    if (!shopifyOrder) {
      return res.status(404).json({
        error: 'Order not found. Please check the order number or email and try again.'
      });
    }

    customerEmail = (shopifyOrder.email || "").trim().toLowerCase();
  } catch (err) {
    console.error("Shopify error:", err);
    return res.status(500).json({ error: 'Error accessing Shopify API.' });
  }

  // Is the order fulfilled?
  const isFulfilled = (shopifyOrder.fulfillment_status || '').toLowerCase() === 'fulfilled';

  // Prepare for Google Sheet check
  const orderName = shopifyOrder.name.replace('#', '').trim();
  let isSongReady = false;
  let mp3Link = null;

  try {
    // Google Sheets Auth
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: 'Sheet1!A2:E',
    });

    const rows = response.data.values || [];
    for (const row of rows) {
      if (row.length >= 5) {
        const orderIdFromSheet = (row[1] || "").replace('#', '').trim();
        const readyValue = (row[4] || "").trim().toLowerCase();

        if (orderIdFromSheet === orderName || orderIdFromSheet === query.trim()) {
          isSongReady = (readyValue === 'yes');
          mp3Link = row[3] ? row[3].trim() : null;
          console.log("✅ Sheet Match:", { orderIdFromSheet, isSongReady, mp3Link });
          break;
        }
      }
    }
  } catch (err) {
    console.error("Google Sheets error:", err);
  }

  // Return combined data
  return res.status(200).json({
    isFulfilled,
    isSongReady,
    mp3Link,
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
