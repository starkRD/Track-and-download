// pages/api/cashfree-webhook.js

import crypto from 'crypto';
import getRawBody from 'raw-body';

export const config = {
  api: {
    bodyParser: false, // Disable Next.js automatic JSON parsing
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
    
    // Compute the HMAC signature using the raw payload and your webhook secret.
    const computedSignature = computeSignature(rawBody);

    // Retrieve the signature provided by Cashfree in the header 'x-webhook-signature'.
    const receivedSignature = req.headers['x-webhook-signature'];
    console.log('Received Signature:', receivedSignature);
    console.log('Computed Signature:', computedSignature);
    
    // If signatures do not match, reject the webhook.
    if (computedSignature !== receivedSignature) {
      return res.status(401).send('Unauthorized: Invalid signature');
    }
    
    // Parse the raw JSON payload
    const payload = JSON.parse(rawBody);
    
    // Extract order details from the payload (adjust keys if necessary)
    const transactionStatus = payload.data?.order?.transaction_status;
    const orderId = payload.data?.order?.order_id;
    
    // If the transaction is successful, update your system record.
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
  const secret = process.env.CASHFREE_SECRET; // Webhook secret key
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  return hmac.digest('base64');
}

async function updateEarlyAccessRecord(orderId, paymentData) {
  console.log(`Updating record for order ${orderId}:`, paymentData);
  // Replace this function with your actual logic to update your persistent store,
  // for example updating a Google Sheet, a database record, or a Shopify order metafield.
}
