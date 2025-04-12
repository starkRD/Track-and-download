import { google } from 'googleapis';
import Shopify from 'shopify-api-node';

export default async function handler(req, res) {
  // ✅ CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*'); // Or replace * with https://songcart.in
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const query = req.query.query;
  if (!query) return res.status(400).json({ error: 'Missing query parameter' });

  // 📌 Google Sheets Setup
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.SHEET_ID;
    const sheetName = 'Sheet1';

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${sheetName}!A2:E`, // Skip headers
    });

    const rows = result.data.values;
    let songRow = null;

    for (const row of rows) {
      const [timestamp, orderId, email, mp3Link, isReady] = row;
      if (
        (orderId && orderId.toLowerCase() === query.toLowerCase()) ||
        (email && email.toLowerCase() === query.toLowerCase())
      ) {
        songRow = { orderId, email, mp3Link, isReady };
        break;
      }
    }

    // 🛍️ Shopify Setup
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
    } catch (shopifyErr) {
      console.warn('Shopify fetch failed:', shopifyErr.message);
    }

    // 🎯 Final Response
    if (!songRow) {
      return res.status(404).json({ error: 'Order not found in Google Sheet' });
    }

    const isSongReady = songRow.isReady?.toLowerCase() === 'yes';
    return res.status(200).json({
      isSongReady,
      mp3Link: songRow.mp3Link,
      order: shopifyOrder,
    });
  } catch (err) {
    console.error('Google Sheet fetch failed:', err.message);
    return res.status(500).json({ error: 'Google Sheet fetch failed' });
  }
}
