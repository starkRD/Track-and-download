// File: /api/create-order.js

import fetch from 'node-fetch';

export default async function handler(req, res) {
  // 1) CORS & preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 2) Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 3) Pull needed fields
  const {
    orderId,
    amount,
    customerName,
    customerEmail,
    customerPhone,
    returnUrl,
    notifyUrl
  } = req.body;

  if (!orderId || !amount || !customerEmail) {
    return res.status(400).json({ error: 'Missing required parameters.' });
  }

  // 4) Build your payload
  const baseOrderId = `${orderId}_${Date.now()}`;
  const payload = {
    order_id: baseOrderId,
    order_amount: amount,
    order_currency: 'INR',
    customer_details: {
      customer_id: `cust_${Date.now()}`,
      customer_name: customerName || 'Customer',
      customer_email: customerEmail,
      customer_phone: customerPhone || '9999999999'
    },
    order_meta: {
      return_url: returnUrl,
      notify_url: notifyUrl
    }
  };

  try {
    // 5) Create the order
    const cfRes = await fetch('https://api.cashfree.com/pg/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
        'x-api-version': '2025-01-01'
      },
      body: JSON.stringify(payload)
    });

    const cfData = await cfRes.json();
    if (!cfRes.ok) {
      console.error('Cashfree error:', cfData);
      return res.status(cfRes.status).json({ error: cfData.message || 'Order creation failed.' });
    }

    // 6) Return exactly what your front‐end checks for
    return res.status(200).json({
      payment_link: cfData.payment_link,           // may be null
      payment_session_id: cfData.payment_session_id // always present on v2025‑01‑01
    });
  } catch (err) {
    console.error('❌ create-order exception', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
