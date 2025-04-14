// pages/api/cashfree-webhook.js

import crypto from 'crypto';
import getRawBody from 'raw-body';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // Log all incoming headers for debugging
  console.log("ALL HEADERS:", req.headers);

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
    const receivedSignature = req.headers['x-cashfree-signature'];
    
    console.log('Received Signature:', receivedSignature);
    console.log('Computed Signature:', computedSignature);
    
    // You may choose to conditionally skip signature verification for PAYMENT_LINK_EVENT
    // if (!receivedSignature) { ... }
    
    if (computedSignature !== receivedSignature) {
      return res.status(401).send('Unauthorized: Invalid signature');
    }
    
    const payload = JSON.parse(rawBody);
    
    const transactionStatus = payload.data?.order?.transaction_status;
    const orderId = payload.data?.order?.order_id;
    
    if (transactionStatus === 'SUCCESS') {
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
  const secret = process.env.CASHFREE_SECRET;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  return hmac.digest('base64');
}

async function updateEarlyAccessRecord(orderId, paymentData) {
  console.log(`Updating record for order ${orderId}:`, paymentData);
  // TODO: Implement update logic here.
}
