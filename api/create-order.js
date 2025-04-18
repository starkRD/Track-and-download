// File: /api/create-order.js
import fetch from 'node-fetch';

export const config = {
  api: {
    bodyParser: false,  // handle OPTIONS + JSON ourselves
  },
};

export default async function handler(req, res) {
  // 1) CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  // 2) Only POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST,OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 3) Parse JSON body
  let body;
  try {
    body = await new Promise((resolve, reject) => {
      let buf = '';
      req.on('data', c => buf += c);
      req.on('end', () => resolve(JSON.parse(buf)));
      req.on('error', reject);
    });
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const {
    orderId,
    amount,
    customerName,
    customerEmail,
    customerPhone,
    returnUrl,
    notifyUrl
  } = body;

  if (!orderId || !amount || !customerEmail || !returnUrl || !notifyUrl) {
    return res.status(400).json({ error: 'orderId, amount, customerEmail, returnUrl & notifyUrl are required' });
  }

  // 4) Build Cashfree payload
  const baseOrderId = `${orderId}_${Date.now()}`;
  const payload = {
    order_id: baseOrderId,
    order_amount: amount,
    order_currency: 'INR',
    customer_details: {
      customer_id: `cust_${Date.now()}`,
      customer_name: customerName || '',
      customer_email: customerEmail,
      customer_phone: customerPhone || ''
    },
    order_meta: {
      return_url: returnUrl,
      notify_url: notifyUrl
    }
  };

  try {
    // 5) Create order
    const cfRes = await fetch('https://api.cashfree.com/pg/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
        'x-api-version':   '2022-09-01',
      },
      body: JSON.stringify(payload)
    });
    const cfData = await cfRes.json();

    if (!cfRes.ok) {
      console.error('Cashfree create-order error:', cfData);
      return res.status(cfRes.status).json({ error: cfData.message || 'Cashfree order creation failed.' });
    }

    // 6) Return
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({
      payment_link:       cfData.payment_link       || null,
      payment_session_id: cfData.payment_session_id || null
    });

  } catch (err) {
    console.error('Create-order exception:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
