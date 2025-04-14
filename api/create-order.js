// pages/api/create-order.js

import fetch from 'node-fetch'; // If on Node 18+, you could use native fetch.

export default async function handler(req, res) {
  // Handle preflight (OPTIONS) for CORS
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
    // Set CORS headers for response
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    const numericAmount = parseFloat(amount);
    const customerId = generateCustomerId();

    // Build payload in snake_case per the newest docs for x-api-version
    const payload = {
      order_id: orderId,                 // snake_case
      order_amount: numericAmount,       // snake_case
      order_currency: 'INR',            // snake_case
      customer_details: {               // snake_case
        customer_id: customerId,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone
      },
      // Optionally add order_meta for return & notify URLs
      order_meta: {
        return_url: process.env.CASHFREE_RETURN_URL || null,
        notify_url: process.env.CASHFREE_NOTIFY_URL || null
      }
    };

    console.log("Payload sent to Cashfree:", payload);

    // Call the new Cashfree endpoint
    const response = await fetch('https://api.cashfree.com/pg/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
        // The new docs require this version header
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

    // This response should now contain "payment_session_id" or the new version's keys
    return res.status(200).json(data);
  } catch (error) {
    console.error('Error creating Cashfree order:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

function generateCustomerId() {
  return "cust_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
}
