export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { email, orderId } = req.body;

    if (!email || !orderId) {
      return res.status(400).json({ error: 'Missing email or orderId' });
    }

    const baseOrderId = orderId.toString().replace('#', '');
    const uniqueId = Date.now();
    const fullOrderId = `${baseOrderId}_${uniqueId}`;

    const payload = {
      order_id: fullOrderId,
      order_amount: 1,
      order_currency: 'INR',
      customer_details: {
        customer_id: `cust_${uniqueId}`,
        customer_name: 'SongCart Customer',
        customer_email: email,
        customer_phone: '9999999999',
      },
      order_meta: {
        return_url: `${process.env.CASHFREE_RETURN_URL}?order=${baseOrderId}`,
        notify_url: process.env.CASHFREE_NOTIFY_URL,
      },
    };

    console.log("⚙️  Sending to Cashfree:", payload);

    const response = await fetch('https://api.cashfree.com/pg/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
        'x-api-version': '2022-09-01',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log("💬 Cashfree response:", data);

    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Cashfree order creation failed.' });
    }

    return res.status(200).json({
      payment_link: data.payment_link,
      payment_session_id: data.payment_session_id,
    });

  } catch (err) {
    console.error("🔥 Server error:", err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
