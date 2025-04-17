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

  if (!orderId || !amount || !customerName || !customerEmail || !customerPhone) {
    return res.status(400).json({ error: 'Missing required payment fields.' });
  }

  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    let baseOrderId = orderId.replace(/^#/, '').replace(/[^A-Za-z0-9_-]/g, '');

    // 🚫 Prevent reusing already generated composite IDs
    if (baseOrderId.includes('_')) {
      return res.status(400).json({ error: 'Duplicate payment not allowed for this order.' });
    }

    const suffix = "_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    const uniqueOrderId = baseOrderId + suffix;

    const numericAmount = parseFloat(amount);
    const customerId = generateCustomerId();

    const payload = {
      order_id: uniqueOrderId,
      order_amount: numericAmount,
      order_currency: 'INR',
      customer_details: {
        customer_id: customerId,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone
      },
      order_meta: {
        return_url: `${process.env.CASHFREE_RETURN_URL}?order=${baseOrderId}`,
        notify_url: process.env.CASHFREE_NOTIFY_URL
      }
    };

    console.log("Sending to Cashfree:", payload);

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
    console.log("Cashfree response:", data);

    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Cashfree order creation failed.' });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('Cashfree Order Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

function generateCustomerId() {
  return "cust_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
}
