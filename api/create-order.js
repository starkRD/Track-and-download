// File: /api/create-order.js

export default async function handler(req, res) {
  // Handle CORS preflight (OPTIONS)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Parse and validate request body
  const {
    orderId,
    amount,
    customerName,
    customerEmail,
    customerPhone,
    returnUrl,
    notifyUrl
  } = req.body;

  if (!orderId || !amount || !customerName || !customerEmail || !customerPhone) {
    return res.status(400).json({ error: 'Missing required payment fields.' });
  }

  // Build a unique base order ID
  const baseOrderId = `${orderId}_${Date.now()}`;

  // Construct payload for Cashfree orders API
  const payload = {
    order_id: baseOrderId,
    order_amount: parseFloat(amount),
    order_currency: 'INR',
    customer_details: {
      customer_id: `cust_${Date.now()}`,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone
    },
    order_meta: {
      return_url: returnUrl,
      notify_url: notifyUrl
    }
  };

  try {
    // Create order on Cashfree
    const cfResponse = await fetch('https://api.cashfree.com/pg/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
        'x-api-version': '2022-09-01'
      },
      body: JSON.stringify(payload)
    });

    const cfData = await cfResponse.json();
    console.log('💬 Cashfree create-order response:', cfData);

    if (!cfResponse.ok) {
      return res.status(cfResponse.status).json({ error: cfData.message || 'Cashfree order creation failed.' });
    }

    // Allow cross‑origin for the response
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Return the official payment link (preferred) and session id
    return res.status(200).json({
      payment_link: cfData.payment_link,
      payment_session_id: cfData.payment_session_id
    });

  } catch (err) {
    console.error('❌ Cashfree create-order error:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}
