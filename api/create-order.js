// File: /api/create-order.js

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const {
    orderId,
    amount,
    customerName,
    customerEmail,
    customerPhone,
    returnUrl,
    notifyUrl
  } = req.body;

  const payload = {
    order_id: `${orderId}_${Date.now()}`,
    order_amount: amount,
    order_currency: "INR",
    customer_details: {
      customer_id: `cust_${Date.now()}`,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone
    },
    order_meta: {
      return_url: `${returnUrl}`,
      notify_url: notifyUrl
    }
  };

  try {
    const response = await fetch('https://api.cashfree.com/pg/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
        'x-api-version': '2025-01-01'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log("💬 Cashfree response:", data);

    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Cashfree order creation failed.' });
    }

    return res.status(200).json({
      payment_link: data.payment_link,
      payment_session_id: data.payment_session_id
    });

  } catch (err) {
    console.error("❌ Cashfree error:", err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
