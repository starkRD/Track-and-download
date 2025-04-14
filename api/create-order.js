// pages/api/create-order.js

import fetch from 'node-fetch';

export default async function handler(req, res) {
  // Handle preflight (OPTIONS) request
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

    // Sanitize the base order ID by removing a leading '#' and any invalid characters.
    let baseOrderId = orderId.replace(/^#/, '').replace(/[^A-Za-z0-9_-]/g, '');
    // Append a unique suffix (timestamp and random number) for each payment attempt.
    const suffix = "_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    const uniqueOrderId = baseOrderId + suffix;

    const numericAmount = parseFloat(amount);
    const customerId = generateCustomerId();

    // Build payload using snake_case fields
    const payload = {
      order_id: uniqueOrderId,          // composite order id for Cashfree
      order_amount: numericAmount,
      order_currency: 'INR',
      customer_details: {
        customer_id: customerId,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone
      },
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

    // Expecting a payment_session_id (or similar) in the response.
    return res.status(200).json(data);
  } catch (error) {
    console.error('Error creating Cashfree order:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

function generateCustomerId() {
  return "cust_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
}
