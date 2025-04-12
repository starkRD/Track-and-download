import { google } from 'googleapis';
import Shopify from 'shopify-api-node';

export default async function handler(req, res) {
  // ✅ Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const query = req.query.query;
  if (!query) return res.status(400).json({ error: 'Missing query parameter' });

  try {
    // 🔐 Auth with Google Service Account
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.SHEET_ID;

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Sheet1!A2:E', // Assuming headers are in row 1
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

    // 🛍️ Fetch Shopify order using Order ID as fallback
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
  } catch (error) {
    console.error('❌ Google Sheet fetch failed:', error.message);
    return res.status(500).json({ error: 'Google Sheet fetch failed' });
  }
}
