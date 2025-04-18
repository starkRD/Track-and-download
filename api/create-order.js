// File: /pages/api/create-order.js

import fetch from 'node-fetch';

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  // 1) Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  // 2) Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 3) Always allow CORS on the actual request
  res.setHeader('Access-Control-Allow-Origin', '*');

  // 4) Validate body
  const {
    orderId,
    amount,
    customerName,
    customerEmail,
    customerPhone,
    returnUrl,
    notifyUrl,
  } = req.body;

  if (
    !orderId ||
    !amount ||
    !customerName ||
    !customerEmail ||
    !customerPhone ||
    !returnUrl ||
    !notifyUrl
  ) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // 5) Build unique order_id
  const cleanId = orderId.toString().replace(/^#/, '').replace(/[^A-Za-z0-9_-]/g, '');
  const baseOrderId = `${cleanId}_${Date.now()}`;

  const payload = {
    order_id: baseOrderId,
    order_amount: Number(amount),
    order_currency: 'INR',
    customer_details: {
      customer_id: `cust_${Date.now()}`,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
    },
    order_meta: {
      return_url: returnUrl,
      notify_url: notifyUrl,
    },
  };

  try {
    // 6) Call Cashfree Create Order
    const cfRes = await fetch('https://api.cashfree.com/pg/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
        // use latest version or override via ENV
        'x-api-version': process.env.CASHFREE_API_VERSION || '2025-01-01',
      },
      body: JSON.stringify(payload),
    });

    const cfData = await cfRes.json();
    if (!cfRes.ok) {
      console.error('Cashfree create-order failed:', cfData);
      return res
        .status(cfRes.status)
        .json({ error: cfData.message || 'Cashfree order creation failed.' });
    }

    // 7) Return both link & session‑id
    return res.status(200).json({
      payment_link: cfData.payment_link,            // if using payment_links API
      payment_session_id: cfData.payment_session_id // if using hosted checkout
    });
  } catch (err) {
    console.error('Error in create-order handler:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
