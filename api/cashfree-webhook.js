// File: /pages/api/cashfree-webhook.js

import crypto from 'crypto';
import getRawBody from 'raw-body';
import { google } from 'googleapis';

export const config = {
  api: {
    bodyParser: false,  // we need the raw body
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    // 1) Read raw JSON string
    const rawBody = await getRawBody(req, {
      length: req.headers['content-length'],
      encoding: 'utf8',
    });

    // 2) Pull the timestamp and signature headers (as per Cashfree docs)
    const timestamp = req.headers['x-webhook-timestamp'];
    const receivedSig = req.headers['x-webhook-signature'];

    if (!timestamp || !receivedSig) {
      console.error('Missing timestamp or signature header');
      return res.status(400).send('Bad Request');
    }

    // 3) Build the string to sign (timestamp + raw JSON)
    const toSign = timestamp + rawBody;

    // 4) Compute HMAC‑SHA256 and Base64‑encode
    const hmac = crypto.createHmac('sha256', process.env.CASHFREE_SECRET);
    hmac.update(toSign);
    const expectedSig = hmac.digest('base64');

    // 5) Compare signatures
    if (expectedSig !== receivedSig) {
      console.error('Signature mismatch', { expectedSig, receivedSig });
      return res.status(401).send('Unauthorized: Invalid signature');
    }

    // 6) Parse the JSON payload now that signature is verified
    const payload = JSON.parse(rawBody);

    // 7) Only handle payment‑success events
    if (payload.type === 'PAYMENT_SUCCESS_WEBHOOK' ||
        payload.event === 'PAYMENT_SUCCESS' ||
        payload.data?.payment?.payment_status === 'SUCCESS') {

      // Extract your composite order ID
      const compositeOrderId =
        payload.data?.order?.order_id ||
        payload.data?.payment?.order_id; 
      const baseOrderId = compositeOrderId.split('_')[0];

      if (baseOrderId) {
        await updateEarlyAccessRecord(baseOrderId);
      } else {
        console.error('Could not extract baseOrderId from', compositeOrderId);
      }
    }

    // 8) Acknowledge
    res.status(200).send('Webhook processed successfully');

  } catch (err) {
    console.error('Error in webhook handler:', err);
    res.status(500).send('Internal Server Error');
  }
}

// Helper: mark column F = “yes” for the matching baseOrderId
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

  // Read column B (order IDs)
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Sheet1!B2:B'
  });
  const rows = result.data.values || [];

  // Find the row matching our baseOrderId
  let rowNumber = null;
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i][0] || '').trim() === baseOrderId) {
      rowNumber = i + 2;  // because sheet rows start at 2
      break;
    }
  }
  if (!rowNumber) {
    console.error('Order ID not found in sheet:', baseOrderId);
    return;
  }

  // Write “yes” into column F for that row
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `Sheet1!F${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [['yes']]
    }
  });
  console.log(`Marked early-access paid for ${baseOrderId} at row ${rowNumber}`);
}
