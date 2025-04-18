// pages/api/cashfree-webhook.js

import crypto from 'crypto';
import getRawBody from 'raw-body';
import { google } from 'googleapis';

export const config = {
  api: {
    bodyParser: false   // <— must be false to get the raw payload
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    // 1) Grab the exact bytes Cashfree sent
    const rawBody = await getRawBody(req, {
      length: req.headers['content-length'],
      encoding: 'utf-8',
    });

    // 2) Verify signature
    const receivedSig = req.headers['x-webhook-signature'];
    const expectedSig = computeSignature(rawBody);

    console.log('Received Signature:', receivedSig);
    console.log('Computed Signature:', expectedSig);

    if (!receivedSig || receivedSig !== expectedSig) {
      console.error('⚠️ Invalid webhook signature');
      return res.status(401).send('Unauthorized: Invalid signature');
    }

    // 3) Parse and handle payload
    const payload = JSON.parse(rawBody);
    const order = payload.data?.order;
    const status = order?.transaction_status;
    const compositeId = order?.order_id;

    console.log('Webhook payload, status:', status, 'order_id:', compositeId);

    if (status === 'SUCCESS' && compositeId) {
      // baseOrderId is the part before the first underscore
      const baseOrderId = compositeId.split('_')[0];
      await updateEarlyAccessRecord(baseOrderId);
    }

    // 4) Ack to Cashfree
    res.status(200).send('Webhook processed successfully');
  } catch (err) {
    console.error('❌ Error in webhook handler:', err);
    res.status(500).send('Internal Server Error');
  }
}

// Compute HMAC‑SHA256( rawBody ) then base64
function computeSignature(rawBody) {
  const secret = process.env.CASHFREE_SECRET; 
  return crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');
}

// Update column F="yes" for the row whose column B matches baseOrderId
async function updateEarlyAccessRecord(baseOrderId) {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const sheetId = process.env.SHEET_ID;

  // 1) Read all of column B
  const getRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Sheet1!B2:B',
  });
  const rows = getRes.data.values || [];

  // 2) Find the matching row
  const matchIndex = rows.findIndex(
    r => (r[0] || '').trim() === baseOrderId.trim()
  );
  if (matchIndex === -1) {
    console.error(`⚠️ Order ${baseOrderId} not found in Sheet1!B2:B`);
    return;
  }
  const rowNumber = matchIndex + 2; // because we started at B2

  // 3) Write “yes” into column F of that row
  const updateRange = `Sheet1!F${rowNumber}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: updateRange,
    valueInputOption: 'RAW',
    requestBody: { values: [['yes']] },
  });

  console.log(`✅ Marked early‑access paid on row ${rowNumber}`);
}
