// pages/api/create-order.js
import fetch from 'node-fetch';

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  console.log('Create order API called with method:', req.method);

  // CORS & preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only POST
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
      notifyUrl
    } = req.body;

    console.log('Received payment request for order:', orderId);

    // Validate
    if (!orderId || !amount || !customerName || !customerEmail || !customerPhone) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    // Clean & unique order_id
    const cleanId = String(orderId).replace(/^#/, '').replace(/[^A-Za-z0-9_-]/g, '');
    const uniqueOrderId = `${cleanId}_${Date.now()}`;

    // Build payload
    const payload = {
      order_id: uniqueOrderId,
      order_amount: Number(amount),
      order_currency: 'INR',
      customer_details: {
        customer_id: `cust_${Date.now()}`,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone
      },
      order_meta: {
        // return_url removed per request
        notify_url: notifyUrl || process.env.CASHFREE_NOTIFY_URL || null
      }
    };

    console.log('Cashfree payload:', JSON.stringify(payload));

    // Create Cashfree order
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
    console.log('Cashfree raw response:', raw);

    let cfData;
    try {
      cfData = JSON.parse(raw);
    } catch (e) {
      console.error('Failed to parse Cashfree response:', e);
      return res.status(500).json({
        error: 'Invalid response from Cashfree',
        details: raw.substring(0, 200)
      });
    }

    if (!cfRes.ok) {
      console.error('Cashfree error:', cfData);
      return res
        .status(cfRes.status || 500)
        .json({ error: cfData.message || 'Cashfree order creation failed.' });
    }

    const sessionId = cfData.payment_session_id;
    if (!sessionId) {
      console.error('No payment_session_id returned:', cfData);
      return res.status(500).json({ error: 'Missing payment_session_id in Cashfree response.' });
    }

    // Build hosted checkout URL
    const paymentLink = `https://payments.cashfree.com/pg/checkout/${sessionId}`;
    console.log('Payment link created:', paymentLink);

    return res.status(200).json({ payment_link: paymentLink });
  } catch (err) {
    console.error('Error in create-order handler:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}
