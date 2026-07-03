// pages/api/create-order.js
import fetch from 'node-fetch';

export const config = {
  api: {
    bodyParser: true,
  },
};

const PAYMENT_TYPES = new Set(['early_access', 'experiment_balance']);

function cleanOrderId(orderId) {
  return String(orderId || '').replace(/^#/, '').replace(/[^A-Za-z0-9_-]/g, '');
}

function getAmountForPaymentType(paymentType, requestedAmount) {
  if (paymentType === 'experiment_balance') {
    const fixedAmount = Number(process.env.EXPERIMENT_BALANCE_AMOUNT || 0);
    if (!fixedAmount || fixedAmount <= 0) {
      throw new Error('EXPERIMENT_BALANCE_AMOUNT is missing in Vercel environment variables.');
    }
    return fixedAmount;
  }

  const amount = Number(requestedAmount);
  if (!amount || amount <= 0) {
    throw new Error('Invalid payment amount.');
  }
  return amount;
}

export default async function handler(req, res) {
  // 1) CORS & preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const {
      orderId,
      amount,
      paymentType = 'early_access',
      customerName,
      customerEmail,
      customerPhone,
      returnUrl,
      notifyUrl
    } = req.body;

    const safePaymentType = String(paymentType || 'early_access').trim();
    if (!PAYMENT_TYPES.has(safePaymentType)) {
      return res.status(400).json({ error: 'Invalid payment type.' });
    }

    // validate
    if (!orderId || !customerName || !customerEmail || !customerPhone) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const finalAmount = getAmountForPaymentType(safePaymentType, amount);

    // build unique order_id
    const cleanId = cleanOrderId(orderId);
    if (!cleanId) return res.status(400).json({ error: 'Invalid order ID.' });

    // Keep payment type inside Cashfree order_id so webhook knows which sheet column to mark.
    const uniqueOrderId = `${cleanId}_${safePaymentType}_${Date.now()}`;

    // payload
    const payload = {
      order_id: uniqueOrderId,
      order_amount: finalAmount,
      order_currency: 'INR',
      customer_details: {
        customer_id: `cust_${Date.now()}`,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
      },
      order_meta: {
        return_url: returnUrl,
        notify_url: notifyUrl,
      }
    };

    // call Cashfree /pg/orders
    const cfRes = await fetch('https://api.cashfree.com/pg/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
        'x-api-version': '2022-09-01'
      },
      body: JSON.stringify(payload)
    });

    const raw = await cfRes.text();
    let cfData;
    try {
      cfData = JSON.parse(raw);
    } catch (e) {
      return res.status(502).json({ error: 'Invalid response from Cashfree', details: raw });
    }

    if (!cfRes.ok) {
      return res.status(cfRes.status).json({ error: cfData.message || 'Cashfree error.' });
    }

    if (!cfData.payment_session_id) {
      return res.status(500).json({ error: 'No payment_session_id returned.' });
    }

    // ONLY return the session id and server-decided amount
    return res.status(200).json({
      paymentSessionId: cfData.payment_session_id,
      amount: finalAmount,
      paymentType: safePaymentType
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}
