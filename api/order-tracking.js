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

    // Lookup by order name (using status: 'any' to include fulfilled orders)
    const nameQuery = query.startsWith("#") ? query : `#${query}`;
    console.log("🔍 Trying name lookup (status:any):", nameQuery);
    const orders = await shopify.order.list({
      name: nameQuery,
      status: 'any',
      limit: 1
    });
    if (orders.length > 0) {
      shopifyOrder = orders[0];
      lookupMethod = "order.name";
    }

    // Fallback: Lookup by order ID
    if (!shopifyOrder && !isNaN(Number(query))) {
      try {
        console.log("🔍 Trying ID lookup:", query);
        shopifyOrder = await shopify.order.get(Number(query));
        lookupMethod = "order.id";
      } catch (idError) {
        console.log("❌ Order ID lookup failed:", idError.message);
      }
    }

    // Fallback: Lookup by email (with status: 'any')
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
      return res.status(404).json({ error: 'Order not found. Please check the order number or email and try again.' });
    }

    customerEmail = (shopifyOrder.email || "").trim().toLowerCase();
  } catch (err) {
    console.error("Shopify error:", err);
    return res.status(500).json({ error: 'Error accessing Shopify API.' });
  }

  const isFulfilled = (shopifyOrder.fulfillment_status || '').toLowerCase() === 'fulfilled';
  const orderName = shopifyOrder.name.replace('#', '').trim();
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

    const rows = response.data.values || [];
    let songs = [];

    for (const row of rows) {
      const orderIdFromSheet = (row[1] || "").replace('#', '').trim();
      const isReady = ((row[4] || "").trim().toLowerCase() === 'yes');
      const uploadCell = (row[3] || "").trim();

      // match this row, and ensure the admin marked "Ready?"
      if ((orderIdFromSheet === orderName || orderIdFromSheet === query.trim()) && isReady) {
        // split on commas (or newlines), trim each link, discard empties
        songs = uploadCell
          .split(/[\n,]+/)
          .map(link => link.trim())
          .filter(link => link);

        console.log("✅ Sheet match for", orderName, "→ songs:", songs);
        break;
      }
    }
  } catch (err) {
    console.error("Google Sheets error:", err);
  }

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
      line_items: shopifyOrder.line_items.map(i => ({ variant_id: i.variant_id })),
    }
  });
}
