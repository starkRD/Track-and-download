// pages/api/cashfree-webhook.js

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }
  
  try {
    // Parse and process the webhook payload (assumes JSON payload with correct Content-Type)
    const payload = req.body;
    
    // Verify the webhook signature (this is a dummy placeholder - replace with actual logic)
    if (!verifyCashfreeSignature(req.headers, payload)) {
      return res.status(401).send('Unauthorized: Invalid signature');
    }
    
    const orderId = payload.orderId;
    const transactionStatus = payload.txStatus;
    
    // For a successful payment, update your persistent record for early access payment
    if (transactionStatus === 'SUCCESS') {
      await updateEarlyAccessRecord(orderId, {
        paid: true,
        transactionId: payload.referenceId,
        timestamp: new Date().toISOString(),
      });
    }
    
    // Respond to Cashfree to acknowledge receipt
    res.status(200).send('Webhook processed successfully');
  } catch (error) {
    console.error("Error processing Cashfree webhook:", error);
    res.status(500).send('Internal Server Error');
  }
}

// Dummy signature verification function.
// Replace this with your actual verification logic as per Cashfree's guidelines.
function verifyCashfreeSignature(headers, payload) {
  // Example: You may need to use a shared secret or use a hashing algorithm
  // to compare the signature provided in the headers against your calculated signature.
  return true;
}

// Dummy update function.
// Replace this with your logic to update your persistent store (e.g., Google Sheet, database, or Shopify metafield).
async function updateEarlyAccessRecord(orderId, paymentData) {
  console.log(`Updating record for order ${orderId}`, paymentData);
  // TODO: Write code here to update your persistent record.
}
