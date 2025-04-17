import { v4 as uuidv4 } from 'uuid';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const {
    orderId,
    amount = 499,
    customerName,
    customerEmail,
    customerPhone
  } = req.body;

  const baseOrderId = orderId || `ORDER_${uuidv4().slice(0, 8)}`;
  const compositeOrderId = `${baseOrderId}_${Date.now()}`;

  // ✅ Add fallback values for safety
  const returnUrl = process.env.CASHFREE_RETURN_URL || 'https://songcart.in/pages/admin-orders';
  const notifyUrl = process.env.CASHFREE_NOTIFY_URL || 'https://track-and-download.vercel.app/api/cashfree-webhook';

  const payload = {
    order_id: compositeOrderId,
    order_amount: amount,
    order_currency: 'INR',
    customer_details: {
      customer_id: `cust_${Date.now()}`,
      customer_name: customerName || 'SongCart User',
      customer_email: customerEmail || 'demo@example.com',
      customer_phone: customerPhone || '9999999999',
    },
    order_meta: {
      return_url: `${returnUrl}?order=${baseOrderId}`,
      notify_url: notifyUrl
    }
  };

  // ✅ Debug logs for safety
  console.log("⚙️  Sending to Cashfree:", JSON.stringify(payload, null, 2));
  console.log("🔐 RETURN_URL:", returnUrl);
  console.log("🔔 NOTIFY_URL:", notifyUrl);

  try {
    const response = await fetch('https://api.cashfree.com/pg/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
        'x-api-version': '2022-09-01' // or your actual API version
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log("💬 Cashfree response:", data);

    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Cashfree order creation failed.' });
    }

    res.status(200).json({ redirectUrl: data.payment_link });
  } catch (err) {
    console.error("❌ Error creating Cashfree order:", err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
