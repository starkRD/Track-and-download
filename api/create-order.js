// pages/api/create-order.js
import fetch from 'node-fetch'; // if you’re on Node <18, otherwise global fetch

export const config = {
  api: {
    bodyParser: false, // we’ll parse JSON ourselves so we can log raw body on OPTIONS too
  },
};

export default async function handler(req, res) {
  // --- 1) CORS preflight ---
  if (req.method === 'OPTIONS') {
    res.setHeader('Access‑Control‑Allow‑Origin', '*');
    res.setHeader('Access‑Control‑Allow‑Methods', 'POST,OPTIONS');
    res.setHeader('Access‑Control‑Allow‑Headers', 'Content-Type');
    return res.status(200).end();
  }

  // --- 2) Validate method ---
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // --- 3) Parse JSON body ---
  let body;
  try {
    body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(err) { reject(err); }
      });
      req.on('error', reject);
    });
  } catch (err) {
    console.error('⛔️ Invalid JSON body', err);
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

  if (!orderId || !amount || !customerEmail) {
    return res.status(400).json({ error: 'Missing orderId, amount or customerEmail' });
  }

  // --- 4) Build Cashfree payload ---
  const base = String(orderId).replace(/[^A-Za-z0-9_-]/g, '');
  const compositeOrderId = `${base}_${Date.now()}`;
  const payload = {
    order_id: compositeOrderId,
    order_amount: parseFloat(amount),
    order_currency: 'INR',
    customer_details: {
      customer_id: `cust_${Date.now()}`,
      customer_name: customerName || 'Guest',
      customer_email: customerEmail,
      customer_phone: customerPhone || '0000000000'
    },
    order_meta: {
      return_url: returnUrl,
      notify_url: notifyUrl
    }
  };

  console.log('➡️ create-order payload:', JSON.stringify(payload));

  // --- 5) Call Cashfree Create Order ---
  let cfRes, cfData;
  try {
    cfRes = await fetch('https://api.cashfree.com/pg/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id':     process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
        'x-api-version':   '2025-01-01'
      },
      body: JSON.stringify(payload)
    });
    cfData = await cfRes.json();
    console.log('💬 Cashfree response:', cfRes.status, cfData);
  } catch (err) {
    console.error('❌ Cashfree network error', err);
    return res.status(502).json({ error: 'Failed to reach Cashfree' });
  }

  // --- 6) Handle errors from Cashfree ---
  if (!cfRes.ok) {
    const msg = cfData.message || 'Cashfree returned an error';
    return res.status(cfRes.status).json({ error: msg });
  }

  // --- 7) Return exactly what the frontend needs ---
  // Cashfree will return either payment_link or payment_session_id (or both).
  return res.status(200).json({
    payment_link: cfData.payment_link || null,
    payment_session_id: cfData.payment_session_id || null
  });
}
