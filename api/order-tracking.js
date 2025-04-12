import { google } from 'googleapis';
import Shopify from 'shopify-api-node';

const shopify = new Shopify({
  shopName: process.env.SHOPIFY_STORE,
  accessToken: process.env.SHOPIFY_ADMIN_TOKEN,
});

export default async function handler(req, res) {
  const { query } = req.query;

  if (!query) return res.status(400).json({ error: 'Missing query' });

  try {
    // 1. Check Google Sheet for early delivery
    const sheetResponse = await fetchGoogleSheet(query);

    if (sheetResponse) {
      return res.status(200).json({
        isSongReady: sheetResponse.isReady,
        mp3Link: sheetResponse.link,
      });
    }

    // 2. Fallback to Shopify order fetch
    const order = await getShopifyOrder(query);

    if (!order) return res.status(404).json({ error: 'Order not found' });

    return res.status(200).json({ order });
  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: 'Google Sheet fetch failed' });
  }
}

// ✅ Fetch from Google Sheet
async function fetchGoogleSheet(query) {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.SHEET_ID;
  const range = 'A2:E1000'; // Adjust range as needed

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const rows = response.data.values;

  if (!rows || rows.length === 0) return null;

  const match = rows.find(
    (row) => row[1]?.toLowerCase() === query.toString().toLowerCase() || row[2]?.toLowerCase() === query.toString().toLowerCase()
  );

  if (match) {
    return {
      isReady: match[4]?.toLowerCase() === 'yes',
      link: match[3] || null,
    };
  }

  return null;
}

// ✅ Fetch from Shopify
async function getShopifyOrder(query) {
  try {
    const orders = await shopify.order.list({
      financial_status: 'paid',
      status: 'any',
      fields: 'id,name,email,line_items,created_at,fulfillment_status',
      limit: 100,
    });

    const matched = orders.find(
      (o) =>
        o.name?.replace('#', '') === query ||
        o.email?.toLowerCase() === query.toLowerCase()
    );

    return matched || null;
  } catch (err) {
    console.error('Shopify Fetch Error:', err.message);
    return null;
  }
}
