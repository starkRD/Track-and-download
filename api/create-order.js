// pages/api/create-order.js

import fetch from 'node-fetch'; // If you're on Node 18+, you could use native fetch.

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

    // Sanitize the orderId: remove a leading '#' and any invalid characters.
    let sanitizedOrderId = orderId.replace(/^#/, '').replace(/[^A-Za-z0-9_-]/g, '');

    const numericAmount = parseFloat(amount);
    const customerId = generateCustomerId();

    // Build payload in snake_case per the newest docs with sanitized order_id.
    const payload = {
      order_id: sanitizedOrderId,
      order_amount: numericAmount,
      order_currency: 'INR',
      customer_details: {
        customer_id: customerId,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone
      },
      // Optionally add order_meta if you have return & notify URLs
      order_meta: {
        return_url: process.env.CASHFREE_RETURN_URL || null,
        notify_url: process.env.CASHFREE_NOTIFY_URL || null
      }
    };

    console.log("Payload sent to Cashfree:", payload);

    // Call the Cashfree order creation endpoint (production)
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

    // Return the response (which should now include "payment_session_id" or similar)
    return res.status(200).json(data);
  } catch (error) {
    console.error('Error creating Cashfree order:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

function generateCustomerId() {
  return "cust_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
}
