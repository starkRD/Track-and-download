// File: pages/api/cashfree-webhook.js

import crypto from 'crypto';
import getRawBody from 'raw-body';
import { google } from 'googleapis';

export const config = {
  api: {
    bodyParser: false, // we need raw body for signature verification
  },
};

export default async function handler(req, res) {
  // 1) Only accept POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }

  // 2) Grab raw request body as string
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

  // 3) Compute HMAC-SHA256 of rawBody using your Cashfree client secret
  const clientSecret = process.env.CASHFREE_CLIENT_SECRET;
  if (!clientSecret) {
    console.error('Missing CASHFREE_CLIENT_SECRET in env');
    return res.status(500).send('Server Misconfiguration');
  }
  const hmac = crypto.createHmac('sha256', clientSecret);
  hmac.update(rawBody, 'utf8');
  const computedSignature = hmac.digest('base64');

  // 4) Compare to header
  const receivedSignature = req.headers['x-webhook-signature'];
  if (!receivedSignature || receivedSignature !== computedSignature) {
    console.error('❌ Invalid webhook signature', {
      received: receivedSignature,
      computed: computedSignature,
    });
    return res.status(401).send('Unauthorized');
  }

  // 5) Parse JSON payload
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error('Invalid JSON payload:', err);
    return res.status(400).send('Bad Request');
  }

  // 6) Only act on PAYMENT_SUCCESS events
  const txStatus = payload.data?.order?.transaction_status;
  if (txStatus !== 'SUCCESS') {
    // ignore other events
    return res.status(200).send('Ignored');
  }

  // 7) Extract baseOrderId (everything before first underscore)
  const compositeId = payload.data.order.order_id || '';
  const baseOrderId = compositeId.split('_')[0];
  if (!baseOrderId) {
    console.error('Could not extract baseOrderId from:', compositeId);
    return res.status(400).send('Bad Request');
  }

  // 8) Update Google Sheet column F for this order
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

    // read column B (order IDs) from row 2 downward
    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Sheet1!B2:B',
    });
    const rows = readRes.data.values || [];

    // find the matching row
    let targetRow = null;
    for (let i = 0; i < rows.length; i++) {
      if ((rows[i][0] || '').trim() === baseOrderId.trim()) {
        targetRow = i + 2; // because B2 is row 2
        break;
      }
    }

    if (!targetRow) {
      console.warn(`Order ${baseOrderId} not found in sheet column B`);
    } else {
      // write "yes" into column F of that row
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
    // we still return 200 so Cashfree won't retry uncontrollably
  }

  // 9) Respond OK
  res.status(200).send('Webhook processed');
}
