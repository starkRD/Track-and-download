// pages/api/create-order.js
import fetch from 'node-fetch';

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  console.log('Create order API called with method:', req.method);
  
  // 1) CORS & Preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 2) Only POST
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

    console.log('Received payment request for order:', orderId);

    // 3) Basic validation
    if (!orderId || !amount || !customerName || !customerEmail || !customerPhone) {
      console.log('Missing required fields:', { orderId, amount, customerName, customerEmail, customerPhone });
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    // 4) Build unique order_id
    const cleanId = String(orderId).replace(/^#/, '').replace(/[^A-Za-z0-9_-]/g, '');
    const uniqueOrderId = `${cleanId}_${Date.now()}`;

    // 5) Prepare payload
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
        return_url: returnUrl,
        notify_url: notifyUrl
      }
    };

    console.log('Cashfree payload:', JSON.stringify(payload));

    // 6) Create order on Cashfree - Updated API version to 2022-09-01 which is standard
    const cfRes = await fetch('https://api.cashfree.com/pg/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
        'x-api-version': '2022-09-01' // Changed from 2025-01-01 to current API version
      },
      body: JSON.stringify(payload)
    });

    // Parse the response as text first to debug
    const responseText = await cfRes.text();
    console.log('Cashfree raw response:', responseText);
    
    // Try to parse it as JSON
    let cfData;
    try {
      cfData = JSON.parse(responseText);
    } catch (e) {
      console.error('Failed to parse Cashfree response as JSON:', e);
      return res.status(500).json({ 
        error: 'Invalid response from payment gateway',
        details: responseText.substring(0, 100) + '...' 
      });
    }

    if (!cfRes.ok) {
      console.error('Cashfree create-order error:', cfData);
      return res
        .status(cfRes.status || 500)
        .json({ error: cfData.message || 'Failed to create Cashfree order.' });
    }

    // 7) Build the hosted-checkout link for the front end
    const sessionId = cfData.payment_session_id;
    if (!sessionId) {
      console.error('No payment_session_id in response:', cfData);
      return res.status(500).json({ error: 'No payment_session_id in Cashfree response.' });
    }
    
    const paymentLink = `https://payments.cashfree.com/pg/checkout/${sessionId}`;
    console.log('Payment link created:', paymentLink);

    // 8) Respond!
    return res.status(200).json({ payment_link: paymentLink });

  } catch (err) {
    console.error('Error in create-order handler:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}
