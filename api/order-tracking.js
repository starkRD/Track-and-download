import { google } from 'googleapis';
import Shopify from 'shopify-api-node';

export default async function handler(req, res) {
  // ✅ Handle CORS for Shopify frontend
  res.setHeader('Access-Control-Allow-Origin', 'https://songcart.in'); // <-- UPDATE this to match your real frontend origin
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const query = req.query.query;
  if (!query) return res.status(400).json({ error: 'Missing query parameter' });

  try {
    // 🔐 Authenticate with Google
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
      range: 'Sheet1!A2:E', // assuming row 1 is headers
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

    // 🛍️ Optional: Shopify order info
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

    if (!songRow) {
      return res.status(404).json({ error: 'Order not found in Google Sheet' });
    }

    return res.status(200).json({
      isSongReady: songRow.isReady,
      mp3Link: songRow.mp3Link,
      order: shopifyOrder,
    });

  } catch (err) {
    console.error('❌ Google Sheet fetch failed:', err.message);
    return res.status(500).json({ error: 'Google Sheet fetch failed' });
  }
}
