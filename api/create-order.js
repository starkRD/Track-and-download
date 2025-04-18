import { getShopifyOrder } from '../../lib/shopify';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { orderNumber, email } = req.body;

  if (!orderNumber || !email) {
    return res.status(400).json({ error: 'Missing orderNumber or email' });
  }

  try {
    const orderData = await getShopifyOrder(orderNumber);
    const baseOrderId = `${orderNumber}_${Date.now()}`;
    const payload = {
      order_id: baseOrderId,
      order_amount: 1,
      order_currency: 'INR',
      customer_details: {
        customer_id: `cust_${Date.now()}`,
        customer_name: 'SongCart Customer',
        customer_email: email,
        customer_phone: '9999999999'
      },
      order_meta: {
        return_url: `${process.env.CASHFREE_RETURN_URL}?order=${orderNumber}`,
        notify_url: process.env.CASHFREE_NOTIFY_URL
      }
    };

    const createOrderResponse = await fetch('https://api.cashfree.com/pg/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
        'x-api-version': '2022-09-01'
      },
      body: JSON.stringify(payload)
    });

    const createOrderData = await createOrderResponse.json();
    if (!createOrderResponse.ok) {
      return res.status(createOrderResponse.status).json({ error: createOrderData.message || 'Cashfree order creation failed.' });
    }

    const paymentLinkResponse = await fetch('https://api.cashfree.com/pg/payment_links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
        'x-api-version': '2022-09-01'
      },
      body: JSON.stringify({
        order_id: baseOrderId,
        customer_details: {
          customer_email: email,
          customer_phone: '9999999999'
        }
      })
    });

    const paymentLinkData = await paymentLinkResponse.json();
    if (!paymentLinkResponse.ok || !paymentLinkData.payment_link_url) {
      return res.status(paymentLinkResponse.status).json({ error: paymentLinkData.message || 'Failed to generate payment link.' });
    }

    return res.status(200).json({ payment_link: paymentLinkData.payment_link_url });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
