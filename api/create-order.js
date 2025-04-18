// File: /api/create-order.js

export default async function handler(req, res) {
  // 1. Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  // 2. Reject anything other than POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 3. Always set CORS on the POST response too
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 4. Pull in the body params
  const {
    orderId,
    amount,
    customerName,
    customerEmail,
    customerPhone,
    returnUrl,
    notifyUrl
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
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  // 5. Build the Cashfree payload
  const uniqueOrderId = `${orderId}_${Date.now()}`;
  const payload = {
    order_id: uniqueOrderId,
    order_amount: amount,
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
    // 6. Create the order in Cashfree
    const cfRes = await fetch('https://api.cashfree.com/pg/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
        // ← Use the latest API version here
        'x-api-version': '2025-01-01'
      },
      body: JSON.stringify(payload)
    });

    const cfData = await cfRes.json();
    console.log('💬 Cashfree create-order response:', cfData);

    if (!cfRes.ok) {
      return res
        .status(cfRes.status)
        .json({ error: cfData.message || 'Cashfree order creation failed.' });
    }

    // 7. Return both possible redirects
    return res.status(200).json({
      payment_link: cfData.payment_link || null,
      payment_session_id: cfData.payment_session_id || null
    });
  } catch (err) {
    console.error('❌ Error in /api/create-order:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
