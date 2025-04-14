// pages/api/create-order.js

import fetch from 'node-fetch'; // If you're on Node 18+, native fetch is available

export default async function handler(req, res) {
  // Handle OPTIONS preflight CORS request
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
  if (!orderId || !amount || !customerName || !customerEmail || !customerPhone) {
    return res.status(400).json({ error: 'Missing required payment fields.' });
  }
  
  try {
    // Set CORS headers for the response
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    const numericAmount = parseFloat(amount);
    const customerId = generateCustomerId();

    // Build payload per Cashfree’s new token-based hosted checkout integration.
    // (Field names are in camelCase as indicated by the docs.)
    const payload = {
      orderId: orderId,
      orderAmount: numericAmount,
      orderCurrency: 'INR',
      customerDetails: {
        customerId,
        customerName,
        customerEmail,
        customerPhone,
      },
      // Optional meta data (if you wish to set return and notify URLs)
      orderMeta: {
        returnUrl: process.env.CASHFREE_RETURN_URL || '',
        notifyUrl: process.env.CASHFREE_NOTIFY_URL || '',
      }
    };

    console.log("Payload sent to Cashfree:", payload);

    // Use Cashfree's new API endpoint for order creation.
    const response = await fetch('https://api.cashfree.com/pg/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log("Response from Cashfree:", data);

    if (!response.ok) {
      console.error('Cashfree create-order error:', data);
      return res.status(response.status).json({ error: data.message || 'Cashfree order creation failed.' });
    }

    // Expect the response to contain "payment_session_id"
    return res.status(200).json(data);
  } catch (error) {
    console.error('Error creating Cashfree order:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

function generateCustomerId() {
  return "cust_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
}
