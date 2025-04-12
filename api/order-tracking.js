import { google } from 'googleapis';
import Shopify from 'shopify-api-node';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const query = req.query.query;
  if (!query) return res.status(400).json({ error: 'Missing order ID or email.' });

  let shopifyOrder = null;
  let customerEmail = "";

  try {
    const shopify = new Shopify({
      shopName: process.env.SHOPIFY_STORE,
      accessToken: process.env.SHOPIFY_ADMIN_TOKEN,
    });

    const orders = await shopify.order.list({ name: `#${query}`, limit: 1 });
    if (orders.length > 0) {
      shopifyOrder = orders[0];
    } else if (!isNaN(Number(query))) {
      shopifyOrder = await shopify.order.get(Number(query)).catch(() => null);
    }

    if (!shopifyOrder) return res.status(404).json({ error: 'Order not found on Shopify' });
    customerEmail = (shopifyOrder.email || "").trim().toLowerCase();

  } catch (err) {
    return res.status(500).json({ error: 'Error fetching Shopify order' });
  }

  let isSongReady = false;
  let mp3Link = null;

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.SHEET_ID;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Sheet1!A2:E',
    });

    const rows = response.data.values || [];
    for (const row of rows) {
      const [ , orderId, , link, ready ] = row;
      if ((orderId?.trim() || "") === query) {
        isSongReady = (ready?.toLowerCase() === 'yes');
        mp3Link = link || null;
        break;
      }
    }

  } catch (err) {
    console.warn("Google Sheet fetch failed:", err.message);
  }

  return res.status(200).json({
    isFulfilled: shopifyOrder.fulfillment_status === "fulfilled",
    isSongReady,
    mp3Link,
    emailFromShopify: customerEmail,
    order: {
      name: shopifyOrder.name,
      created_at: shopifyOrder.created_at,
      fulfillment_status: shopifyOrder.fulfillment_status,
      email: customerEmail,
      line_items: shopifyOrder.line_items.map(i => ({ variant_id: i.variant_id })),
    }
  });
}
