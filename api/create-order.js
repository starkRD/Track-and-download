// /pages/api/create-order.js
import fetch from 'node-fetch';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Parse JSON
  let body;
  try {
    body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (err) { reject(err); }
      });
      req.on('error', reject);
    });
  } catch (err) {
    console.error('Invalid JSON:', err);
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { orderId, amount, customerEmail, returnUrl, notifyUrl } = body;
  if (!orderId || !amount || !customerEmail || !returnUrl || !notifyUrl) {
    return res.status(400).json({ error: 'Missing one of orderId,amount,customerEmail,returnUrl,notifyUrl' });
  }

  // Build payload
  const base = String(orderId).replace(/[^A-Za-z0-9_-]/g, '');
  const compositeOrderId = `${base}_${Date.now()}`;
  const payload = {
    order_id: compositeOrderId,
    order_amount: parseFloat(amount),
    order_currency: 'INR',
    customer_details: {
      customer_id: `cust_${Date.now()}`,
      customer_email: customerEmail,
      customer_phone: body.customerPhone || '0000000000',
    },
    order_meta: {
      return_url: returnUrl,
      notify_url: notifyUrl,
    }
  };

  console.log('→ CF payload:', payload);

  // Call Cashfree
  let cfRes, cfData;
  try {
    cfRes = await fetch('https://api.cashfree.com/pg/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id':     process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
        'x-api-version':   '2025-01-01',
      },
      body: JSON.stringify(payload),
    });
    cfData = await cfRes.json();
    console.log('← CF response:', cfRes.status, cfData);
  } catch (err) {
    console.error('CF network error:', err);
    return res.status(502).json({ error: 'Cashfree unreachable' });
  }

  if (!cfRes.ok) {
    return res.status(cfRes.status).json({ error: cfData.message || 'CF returned error' });
  }

  return res.status(200).json({
    payment_link: cfData.payment_link || null,
    payment_session_id: cfData.payment_session_id || null,
  });
}
