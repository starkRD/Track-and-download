// pages/api/cashfree-webhook.js

import crypto from 'crypto';
import getRawBody from 'raw-body';

export const config = {
  api: {
    bodyParser: false, // Disable Next.js automatic body parsing
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    // Read the raw request body as a string.
    const rawBody = await getRawBody(req, {
      length: req.headers['content-length'],
      encoding: 'utf-8',
    });
    
    // For debugging, log the raw body (remove or disable in production)
    console.log('Raw body:', rawBody);
    
    // Compute the signature using the raw payload
    const computedSignature = computeSignature(rawBody);
    
    // Retrieve the signature sent by Cashfree.
    // Check that the header name matches what Cashfree sends.
    // For example, if Cashfree uses "x-cashfree-signature":
    const receivedSignature = req.headers['x-cashfree-signature'];
    
    console.log('Received Signature:', receivedSignature);
    console.log('Computed Signature:', computedSignature);
    
    // If signatures do not match, reject the request.
    if (computedSignature !== receivedSignature) {
      return res.status(401).send('Unauthorized: Invalid signature');
    }
    
    // Parse the raw body as JSON (since we need to process the webhook data)
    const payload = JSON.parse(rawBody);
    
    // Process the Payment Links webhook payload.
    // (For example, check if payment was successful and then update your record.)
    const transactionStatus = payload.data?.order?.transaction_status;
    const orderId = payload.data?.order?.order_id;
    
    if (transactionStatus === 'SUCCESS') {
      // Update your persistent record
      await updateEarlyAccessRecord(orderId, {
        paid: true,
        transactionId: payload.data.order.transaction_id,
        timestamp: new Date().toISOString(),
      });
    }
    
    res.status(200).send('Webhook processed successfully');
  } catch (error) {
    console.error("Error processing Cashfree webhook:", error);
    res.status(500).send('Internal Server Error');
  }
}

/**
 * Compute the HMAC SHA256 signature over the raw payload and encode it in base64.
 * @param {string} rawBody - The raw JSON string received from Cashfree.
 * @returns {string} - The computed signature.
 */
function computeSignature(rawBody) {
  // Get your secret key from environment variables.
  const secret = process.env.CASHFREE_SECRET;
  
  // Create HMAC using SHA256, then update with the raw payload,
  // and finally base64 encode the digest.
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  return hmac.digest('base64');
}

/**
 * Dummy function to update the early access record.
 * Replace this with your actual logic (e.g., update Google Sheets, database, or Shopify metafield).
 */
async function updateEarlyAccessRecord(orderId, paymentData) {
  console.log(`Updating record for order ${orderId}:`, paymentData);
  // TODO: Implement your update logic.
}
