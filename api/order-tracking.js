import { google } from 'googleapis';
import Shopify from 'shopify-api-node';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const query = req.query.query;
  if (!query) return res.status(400).json({ error: 'Missing query parameter' });

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

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Sheet1!A2:E',
    });

    const rows = response.data.values || [];
    let songRow = null;

    for (const row of rows) {
      const [timestamp, orderId, customerEmail, mp3Link, isReady] = row;
      if (
        (orderId && orderId.toLowerCase() === query.toLowerCase()) ||
        (customerEmail && customerEmail.toLowerCase() === query.toLowerCase())
      ) {
        songRow = {
          orderId,
          email: customerEmail,
          mp3Link,
          isReady: isReady?.toLowerCase() === 'yes',
        };
        break;
      }
    }

    // Attempt to fetch Shopify Order
    let shopifyOrder = null;
    try {
      const shopify = new Shopify({
        shopName: process.env.SHOPIFY_STORE,
        accessToken: process.env.SHOPIFY_ADMIN_TOKEN,
      });

      const orders = await shopify.order.list({ name: `#${query}`, limit: 1 });
      if (orders.length > 0) {
        shopifyOrder = orders[0];
      }
    } catch (err) {
      console.warn('⚠️ Shopify fetch failed:', err.message);
    }

    // Determine delivery timeline
    let deliveryHours = 240; // default fallback
    if (shopifyOrder && shopifyOrder.line_items) {
      const variantMap = {
        "41290369269835": 240, // Beast
        "41290369302603": 120, // Premium
        "41274164510795": 120,
        "41290369335371": 30,  // Premium
        "41290369368139": 30,  // Premium
        "41274164543563": 48,
        "41274164576331": 24
      };

      const times = shopifyOrder.line_items
        .map(item => variantMap[item.variant_id?.toString()])
        .filter(Boolean);

      if (times.length) deliveryHours = Math.min(...times);
    }

    // Compute dates
    let createdAt = shopifyOrder?.created_at || new Date().toISOString();
    const orderDate = new Date(createdAt);
    const deliveryDeadline = new Date(orderDate.getTime() + deliveryHours * 60 * 60 * 1000);

    // Determine current status
    const now = new Date();
    let fulfillmentStatus = (shopifyOrder?.fulfillment_status || "").toLowerCase();
    let currentStatus = "Order Received";

    const elapsedHours = (now - orderDate) / 3600000;
    if (elapsedHours >= deliveryHours) currentStatus = "Order Ready";
    if (elapsedHours >= deliveryHours * 0.8) currentStatus = "Final Editing";
    if (elapsedHours >= deliveryHours * 0.5) currentStatus = "Song Production";
    if (elapsedHours >= deliveryHours * 0.2) currentStatus = "Lyrics Composition";

    if (fulfillmentStatus === "fulfilled" || now >= deliveryDeadline) {
      currentStatus = "Delivered";
    }

    if (!songRow) {
      return res.status(404).json({ error: 'Order not found in Google Sheet' });
    }

    return res.status(200).json({
      isSongReady: songRow.isReady,
      mp3Link: songRow.mp3Link,
      order: {
        ...shopifyOrder,
        deliveryHours,
        currentStatus,
        orderDate,
        deliveryDeadline,
      },
    });

  } catch (error) {
    console.error('❌ Google Sheet fetch failed:', error.message);
    return res.status(500).json({ error: 'Google Sheet fetch failed' });
  }
}
