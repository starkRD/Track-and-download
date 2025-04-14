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
    // Read the raw request body
    const rawBody = await getRawBody(req, {
      length: req.headers['content-length'],
      encoding: 'utf-8',
    });
    
    console.log('Raw body:', rawBody);
    
    // Compute local signature from raw body
    const computedSignature = computeSignature(rawBody);

    // Cashfree’s Payment Link or Payment Gateway webhooks often include 'x-webhook-signature'
    const receivedSignature = req.headers['x-webhook-signature'];
    console.log('Received Signature:', receivedSignature);
    console.log('Computed Signature:', computedSignature);

    if (computedSignature !== receivedSignature) {
      return res.status(401).send('Unauthorized: Invalid signature');
    }
    
    // Parse JSON
    const payload = JSON.parse(rawBody);

    // Example: For Payment Gateway or Payment Link events, the structure might vary
    const transactionStatus = payload.data?.order?.transaction_status;
    const orderId = payload.data?.order?.order_id;

    if (transactionStatus === 'SUCCESS') {
      // Mark early access as paid, e.g., in a DB, Google Sheet, or Shopify metafield
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

function computeSignature(rawBody) {
  const secret = process.env.CASHFREE_SECRET; // Ensure this is the correct secret
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  return hmac.digest('base64');
}

// Replace with real logic for updating your records
async function updateEarlyAccessRecord(orderId, paymentData) {
  console.log(`Updating record for order ${orderId}:`, paymentData);
  // TODO: Implement logic here, e.g., update a Google Sheet or Shopify metafield
}
