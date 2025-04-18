// pages/api/create-order.js
import fetch from 'node-fetch';

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  // 1) CORS & preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const {
      orderId,
      amount,
      customerName,
      customerEmail,
      customerPhone,
      returnUrl,
      notifyUrl
    } = req.body;

    // validate
    if (!orderId || !amount || !customerName || !customerEmail || !customerPhone) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    // build unique order_id
    const cleanId = String(orderId).replace(/^#/, '').replace(/[^A-Za-z0-9_-]/g, '');
    const uniqueOrderId = `${cleanId}_${Date.now()}`;

    // payload
    const payload = {
      order_id: uniqueOrderId,
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
      }
    };

    // call Cashfree /pg/orders
    const cfRes = await fetch('https://api.cashfree.com/pg/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
        'x-api-version': '2022-09-01'
      },
      body: JSON.stringify(payload)
    });

    const raw = await cfRes.text();
    let cfData;
    try {
      cfData = JSON.parse(raw);
    } catch (e) {
      return res.status(502).json({ error: 'Invalid response from Cashfree', details: raw });
    }

    if (!cfRes.ok) {
      return res.status(cfRes.status).json({ error: cfData.message || 'Cashfree error.' });
    }

    if (!cfData.payment_session_id) {
      return res.status(500).json({ error: 'No payment_session_id returned.' });
    }

    // ONLY return the session id
    return res.status(200).json({
      paymentSessionId: cfData.payment_session_id
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}
