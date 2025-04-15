// pages/api/create-order.js

import fetch from 'node-fetch'; // For Node versions before 18

export default async function handler(req, res) {
  // Handle preflight (OPTIONS)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  
  const { orderId, amount, customerName, customerEmail, customerPhone } = req.body;
  
  // Validate required fields
  if (!orderId || !amount || !customerName || !customerEmail || !customerPhone) {
    return res.status(400).json({ error: 'Missing required payment fields.' });
  }
  
  try {
    // Set CORS headers for response
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Sanitize base order id: remove any leading "#" and invalid characters.
    let baseOrderId = orderId.replace(/^#/, '').replace(/[^A-Za-z0-9_-]/g, '');
    // Append a unique suffix (timestamp and random number)
    const suffix = "_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    const uniqueOrderId = baseOrderId + suffix;

    const numericAmount = parseFloat(amount);
    const customerId = generateCustomerId(); // This can be generated or retrieved if available.

    // Build the payload using snake_case as required.
    const payload = {
      order_id: uniqueOrderId,          // unique composite order id.
      order_amount: numericAmount,
      order_currency: 'INR',
      customer_details: {
        customer_id: customerId,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone
      },
      // Optional meta: you can include return_url or notify_url
      order_meta: {
        return_url: process.env.CASHFREE_RETURN_URL || null,
        notify_url: process.env.CASHFREE_NOTIFY_URL || null,
      }
    };

    console.log("Payload sent to Cashfree:", payload);

    const response = await fetch('https://api.cashfree.com/pg/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
        'x-api-version': '2025-01-01'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log("Response from Cashfree:", data);

    if (!response.ok) {
      console.error('Cashfree create-order error:', data);
      return res.status(response.status).json({ error: data.message || 'Cashfree order creation failed.' });
    }

    // Return the successful response (must include payment_session_id).
    return res.status(200).json(data);
  } catch (error) {
    console.error('Error creating Cashfree order:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

function generateCustomerId() {
  return "cust_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
}
