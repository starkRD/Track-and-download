// pages/api/create-order.js

import fetch from 'node-fetch'; // If using Node 18+, you can use global fetch instead

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { orderId, amount, customerName, customerEmail, customerPhone } = req.body;

  // Validate required fields
  if (!orderId || !amount || !customerName || !customerEmail || !customerPhone) {
    return res.status(400).json({ error: 'Missing required payment fields.' });
  }

  try {
    // Call Cashfree's "create order" or "cftoken/order" endpoint
    const response = await fetch('https://api.cashfree.com/api/v2/cftoken/order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Pass your Cashfree client credentials. Make sure these are set in Vercel env vars.
        'x-client-id': process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
      },
      body: JSON.stringify({
        order_id: orderId,
        order_amount: amount,
        order_currency: 'INR',
        customer_details: {
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Cashfree create-order error:', data);
      return res.status(response.status).json({ error: data.message || 'Cashfree order creation failed.' });
    }

    // data typically contains a token or a link to proceed with payment
    return res.status(200).json(data);
  } catch (error) {
    console.error('Error creating Cashfree order:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
