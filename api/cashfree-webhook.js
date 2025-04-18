// File: pages/api/cashfree-webhook.js

import crypto from 'crypto';
import getRawBody from 'raw-body';
import { google } from 'googleapis';

export const config = {
  api: {
    bodyParser: false,  // we need the raw body for signature verification
  },
};

export default async function handler(req, res) {
  // 1) Only accept POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }

  // 2) Read raw request body
  let rawBody;
  try {
    rawBody = await getRawBody(req, {
      length: req.headers['content-length'],
      encoding: 'utf-8',
    });
  } catch (err) {
    console.error('Error reading rawBody:', err);
    return res.status(400).send('Bad Request');
  }

  // 3) Parse JSON
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error('Invalid JSON payload:', err);
    return res.status(400).send('Bad Request');
  }

  // 4) Flatten object for signature as per Cashfree spec
  //    Merge top‑level event fields plus all keys under data.order
  const flat = {
    event:      payload.event,
    event_time: payload.event_time,
    ...payload.data?.order
  };

  // 5) Build the postData by sorting keys and concatenating values
  const sortedKeys = Object.keys(flat).sort();
  const postData = sortedKeys.map(key => String(flat[key] ?? '')).join('');

  // 6) Compute HMAC‑SHA256 of postData using your client secret
  const clientSecret = process.env.CASHFREE_CLIENT_SECRET;
  if (!clientSecret) {
    console.error('Missing CASHFREE_CLIENT_SECRET environment variable');
    return res.status(500).send('Server Misconfiguration');
  }
  const hmac = crypto.createHmac('sha256', clientSecret);
  hmac.update(postData, 'utf8');
  const expectedSig = hmac.digest('base64');

  // 7) Compare to header
  const receivedSig = req.headers['x-webhook-signature'];
  if (!receivedSig || receivedSig !== expectedSig) {
    console.error('❌ Invalid webhook signature', { receivedSig, expectedSig });
    return res.status(401).send('Unauthorized');
  }

  // 8) Only handle successful payments
  const txStatus = payload.data?.order?.transaction_status;
  if (txStatus !== 'SUCCESS') {
    // no action for other statuses
    return res.status(200).send('Ignored');
  }

  // 9) Extract baseOrderId (before first "_")
  const compositeId = payload.data.order.order_id || '';
  const baseOrderId = compositeId.split('_')[0];
  if (!baseOrderId) {
    console.error('Could not extract baseOrderId from:', compositeId);
    return res.status(400).send('Bad Request');
  }

  // 10) Update Google Sheet column F for this order
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.SHEET_ID;

    // Read column B (order IDs) from row 2 onward
    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Sheet1!B2:B',
    });
    const rows = readRes.data.values || [];

    // Find matching row
    let targetRow = null;
    for (let i = 0; i < rows.length; i++) {
      if ((rows[i][0] || '').trim() === baseOrderId.trim()) {
        targetRow = i + 2; // because row 2 corresponds to index 0
        break;
      }
    }

    if (!targetRow) {
      console.warn(`Order ${baseOrderId} not found in sheet column B`);
    } else {
      // Write "yes" into column F of that row
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `Sheet1!F${targetRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: [['yes']] },
      });
      console.log(`✅ Marked early access paid for order ${baseOrderId} at row ${targetRow}`);
    }
  } catch (err) {
    console.error('Error updating Google Sheet:', err);
    // We still return 200 so Cashfree won't retry repeatedly
  }

  // 11) Respond OK
  res.status(200).send('Webhook processed');
}
