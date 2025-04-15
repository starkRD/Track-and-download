// pages/api/cashfree-webhook.js

import crypto from 'crypto';
import getRawBody from 'raw-body';
import { google } from 'googleapis';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }
  
  try {
    const rawBody = await getRawBody(req, {
      length: req.headers['content-length'],
      encoding: 'utf-8',
    });
    
    console.log('Raw body:', rawBody);
    
    const computedSignature = computeSignature(rawBody);
    const receivedSignature = req.headers['x-webhook-signature'];
    console.log('Received Signature:', receivedSignature);
    console.log('Computed Signature:', computedSignature);
    
    if (computedSignature !== receivedSignature) {
      return res.status(401).send('Unauthorized: Invalid signature');
    }
    
    const payload = JSON.parse(rawBody);
    const transactionStatus = payload.data?.order?.transaction_status;
    const compositeOrderId = payload.data?.order?.order_id; // This is the composite id from Cashfree
    
    if (transactionStatus === 'SUCCESS') {
      // Extract the base order id. Assume it's the part before the first underscore.
      const baseOrderId = compositeOrderId ? compositeOrderId.split('_')[0] : null;
      if (baseOrderId) {
        await updateEarlyAccessRecord(baseOrderId, {
          paid: true,
          transactionId: payload.data.order.transaction_id,
          timestamp: new Date().toISOString()
        });
      } else {
        console.error("Could not extract base order id from composite: ", compositeOrderId);
      }
    }
    
    res.status(200).send('Webhook processed successfully');
  } catch (error) {
    console.error("Error processing Cashfree webhook:", error);
    res.status(500).send('Internal Server Error');
  }
}

function computeSignature(rawBody) {
  const secret = process.env.CASHFREE_SECRET;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  return hmac.digest('base64');
}

async function updateEarlyAccessRecord(baseOrderId, paymentData) {
  console.log(`Updating record for base order ${baseOrderId}:`, paymentData);

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const sheetId = process.env.SHEET_ID;

  try {
    // Get the entire column B (assuming order IDs are in column B, starting from row 2)
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Sheet1!B2:B',
    });

    const rows = result.data.values;
    if (!rows || rows.length === 0) {
      console.error("No rows found in the sheet");
      return;
    }

    // Find the row that has a matching order id. Since we're storing the base order id,
    // compare with baseOrderId.
    let rowNumber = null;
    for (let i = 0; i < rows.length; i++) {
      const sheetOrderId = rows[i][0] ? rows[i][0].trim() : "";
      if (sheetOrderId === baseOrderId.trim()) {
        rowNumber = i + 2; // because range starts at row 2
        break;
      }
    }

    if (!rowNumber) {
      console.error(`Base order id ${baseOrderId} not found in the sheet.`);
      return;
    }

    const updateRange = `Sheet1!F${rowNumber}`; // Assuming column F is used for early access status
    const updateResult = await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: updateRange,
      valueInputOption: 'RAW',
      requestBody: { values: [["yes"]] },
    });
    console.log(`Updated sheet row ${rowNumber} for base order ${baseOrderId}:`, updateResult.data);
  } catch (err) {
    console.error("Error updating the Google Sheet:", err);
  }
}
