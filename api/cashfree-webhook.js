// pages/api/cashfree-webhook.js

import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    // Assume the body is JSON and Next.js has parsed it.
    const payload = req.body;

    // Verify the webhook signature using our custom function.
    if (!verifyCashfreeSignature(req.headers, payload)) {
      return res.status(401).send('Unauthorized: Invalid signature');
    }

    const orderId = payload.orderId;
    const transactionStatus = payload.txStatus;

    // If payment was successful, update your record.
    if (transactionStatus === 'SUCCESS') {
      await updateEarlyAccessRecord(orderId, {
        paid: true,
        transactionId: payload.referenceId,
        timestamp: new Date().toISOString(),
      });
    }

    // Return a successful response.
    res.status(200).send('Webhook processed successfully');
  } catch (error) {
    console.error("Error processing Cashfree webhook:", error);
    res.status(500).send('Internal Server Error');
  }
}

/**
 * Verify the Cashfree webhook signature.
 *
 * Steps:
 * 1. Sort the data keys alphabetically.
 * 2. Concatenate all the values (in order) to form a string (postData).
 * 3. Create an HMAC SHA256 hash of that string using your secret key.
 * 4. Base64 encode the resulting hash.
 * 5. Compare it with the signature that came in the header.
 */
function verifyCashfreeSignature(headers, payload) {
  const clientSecret = process.env.CASHFREE_SECRET; // Your secret key from Cashfree.
  
  // Retrieve the signature sent by Cashfree. Make sure the header name matches.
  const receivedSignature = headers['x-cashfree-signature'];
  
  // 1. Get all keys from the payload and sort them.
  const sortedKeys = Object.keys(payload).sort();

  // 2. Concatenate the corresponding values.
  let postData = '';
  for (const key of sortedKeys) {
    postData += payload[key];
  }

  // 3. Generate a hash using HMAC-SHA256 with your secret.
  const hmac = crypto.createHmac('sha256', clientSecret);
  hmac.update(postData);
  
  // 4. Base64 encode the hash.
  const computedSignature = hmac.digest('base64');

  // Debug: Log both signatures for testing (remove or disable these logs in production)
  console.log('Received Signature:', receivedSignature);
  console.log('Computed Signature:', computedSignature);

  // 5. Compare your computed signature with the one received.
  return computedSignature === receivedSignature;
}

/**
 * Dummy update function to record that early access payment was successful.
 * Replace with your actual code to update a Google Sheet, database, or Shopify order metafield.
 */
async function updateEarlyAccessRecord(orderId, paymentData) {
  console.log(`Updating record for order ${orderId}:`, paymentData);
  // TODO: Implement the update (e.g., using Google Sheets API or your database)
}
