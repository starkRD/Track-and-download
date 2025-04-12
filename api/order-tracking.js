// 📦 SongCart Order Tracking API — Final Logic
import { google } from 'googleapis';
import Shopify from 'shopify-api-node';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const query = req.query.query;
  if (!query) return res.status(400).json({ error: 'Missing query parameter' });

  try {
    // ✅ Step 1: Fetch Shopify Order
    const shopify = new Shopify({
      shopName: process.env.SHOPIFY_STORE,
      accessToken: process.env.SHOPIFY_ADMIN_TOKEN,
    });

    let order = null;
    try {
      const orders = await shopify.order.list({ name: `#${query}`, limit: 1 });
      if (orders.length > 0) {
        order = orders[0];
      }
    } catch (err) {
      console.warn('⚠️ Shopify Fetch Error:', err.message);
    }

    if (!order) return res.status(404).json({ error: 'Order not found on Shopify' });

    const variantMap = {
      "41290369269835": 240, "41290369302603": 120, "41274164510795": 120,
      "41290369335371": 30,  "41290369368139": 30,
      "41274164543563": 48,  "41274164576331": 24
    };

    const hours = (order.line_items || [])
      .map(i => variantMap[String(i.variant_id)])
      .filter(Boolean)[0] || 240;

    const createdDate = new Date(order.created_at);
    const expectedDelivery = new Date(createdDate.getTime() + hours * 60 * 60 * 1000);
    const fulfilled = order.fulfillment_status === 'fulfilled';
    const now = new Date();

    const isDelivered = fulfilled || now >= expectedDelivery;

    // ✅ Step 2: Fetch from Google Sheet
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.SHEET_ID;
    const sheetRange = 'Sheet1!A2:E';

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: sheetRange,
    });

    const rows = response.data.values || [];
    const match = rows.find(([ , orderId, email ]) =>
      (orderId && orderId.trim().toLowerCase() === query.trim().toLowerCase()) ||
      (email && email.trim().toLowerCase() === query.trim().toLowerCase())
    );

    let isSongReady = false;
    let mp3Link = null;

    if (match) {
      const [, , , link, ready] = match;
      isSongReady = (ready || '').toLowerCase() === 'yes';
      mp3Link = link || null;
    }

    return res.status(200).json({
      isSongReady,
      mp3Link,
      isDelivered,
      order: {
        name: order.name,
        created_at: order.created_at,
        fulfillment_status: order.fulfillment_status,
        line_items: order.line_items.map(i => ({ variant_id: i.variant_id })),
        delivery_hours: hours
      }
    });
  } catch (err) {
    console.error('❌ Error:', err.message);
    return res.status(500).json({ error: 'Server error while tracking order' });
  }
}
