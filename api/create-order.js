// File: /api/create-order.js

import fetch from 'node-fetch';

export default async function handler(req, res) {
  // Allow preflight & POST only
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const {
    orderId,
    amount,
    customerName,
    customerEmail,
    customerPhone,
    returnUrl,
    notifyUrl
  } = req.body;

  if (!orderId || !amount || !customerEmail || !returnUrl || !notifyUrl) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  // 1) Create the order
  const baseOrderId = `${orderId}_${Date.now()}`;
  const orderPayload = {
    order_id: baseOrderId,
    order_amount: amount,
    order_currency: 'INR',
    customer_details: {
      customer_id: `cust_${Date.now()}`,
      customer_name: customerName || 'Customer',
      customer_email: customerEmail,
      customer_phone: customerPhone || '9999999999',
    },
    order_meta: {
      return_url: returnUrl,
      notify_url: notifyUrl,
    },
  };

  let cfOrder;
  try {
    const resp = await fetch('https://api.cashfree.com/pg/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
        'x-api-version': process.env.CASHFREE_API_VERSION || '2025-01-01',
      },
      body: JSON.stringify(orderPayload),
    });
    cfOrder = await resp.json();
    if (!resp.ok) {
      return res
        .status(resp.status)
        .json({ error: cfOrder.message || 'Order creation failed' });
    }
  } catch (err) {
    console.error('Cashfree /orders error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }

  // 2) Generate a hosted payment link
  let cfLink;
  try {
    const resp = await fetch('https://api.cashfree.com/pg/payment_links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
        'x-api-version': process.env.CASHFREE_API_VERSION || '2025-01-01',
      },
      body: JSON.stringify({
        order_id: cfOrder.order_id,
        customer_details: {
          customer_email: customerEmail,
          customer_phone: customerPhone || '9999999999',
        },
      }),
    });
    cfLink = await resp.json();
    if (!resp.ok || !cfLink.payment_link_url) {
      return res
        .status(resp.status)
        .json({ error: cfLink.message || 'Failed to generate payment link.' });
    }
  } catch (err) {
    console.error('Cashfree /payment_links error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }

  // 3) Return the full URL
  return res.status(200).json({
    payment_link: cfLink.payment_link_url
  });
}
