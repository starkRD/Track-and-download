// pages/api/cashfree-webhook.js

import crypto from 'crypto';
import getRawBody from 'raw-body';

export const config = {
  api: {
    bodyParser: false, // Disable automatic parsing so we can verify the raw payload
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }
  
  try {
    // Obtain the raw request body as a string.
    const rawBody = await getRawBody(req, {
      length: req.headers['content-length'],
      encoding: 'utf-8',
    });
    
    console.log('Raw body:', rawBody);
    
    // Compute the HMAC signature using the raw body and your webhook secret.
    const computedSignature = computeSignature(rawBody);
    // Retrieve the signature from the header 'x-webhook-signature'
    const receivedSignature = req.headers['x-webhook-signature'];
    console.log('Received Signature:', receivedSignature);
    console.log('Computed Signature:', computedSignature);
    
    if (computedSignature !== receivedSignature) {
      return res.status(401).send('Unauthorized: Invalid signature');
    }
    
    // Parse the raw body JSON
    const payload = JSON.parse(rawBody);
    
    // Extract necessary payment details. Adjust field names as per the new API.
    const transactionStatus = payload.data?.order?.transaction_status;
    const orderId = payload.data?.order?.order_id;
    
    if (transactionStatus === 'SUCCESS') {
      await updateEarlyAccessRecord(orderId, {
        paid: true,
        transactionId: payload.data.order.transaction_id,
        timestamp: new Date().toISOString()
      });
    }
    
    res.status(200).send('Webhook processed successfully');
  } catch (error) {
    console.error("Error processing Cashfree webhook:", error);
    res.status(500).send('Internal Server Error');
  }
}

function computeSignature(rawBody) {
  const secret = process.env.CASHFREE_SECRET; // Ensure this key is correct for webhook verification
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  return hmac.digest('base64');
}

async function updateEarlyAccessRecord(orderId, paymentData) {
  console.log(`Updating record for order ${orderId}:`, paymentData);
  // TODO: Implement your update logic (e.g., update a database, Google Sheet, or Shopify metafield)
}
