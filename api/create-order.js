// pages/api/create-order.js

import fetch from 'node-fetch'; // Ensure this is installed or use global fetch if available

export default async function handler(req, res) {
  // Handle preflight OPTIONS request for CORS
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { orderId, amount, customerName, customerEmail, customerPhone } = req.body;

  // Basic validation of input
  if (!orderId || !amount || !customerName || !customerEmail || !customerPhone) {
    return res.status(400).json({ error: 'Missing required payment fields.' });
  }

  try {
    // Set CORS headers for the response
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Convert amount to a number (if it isn't already)
    const numericAmount = parseFloat(amount);

    // Build the payload exactly as expected by Cashfree.
    const payload = {
      order_id: orderId,
      order_amount: numericAmount,
      order_currency: 'INR',
      customer_details: {
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
      }
    };

    // Log the outgoing payload for debugging
    console.log("Payload sent to Cashfree:", payload);

    // Call Cashfree's production endpoint
    const response = await fetch('https://api.cashfree.com/api/v2/cftoken/order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Ensure these match exactly what Cashfree docs state:
        'x-client-id': process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
      },
      body: JSON.stringify(payload)
    });

    // Log raw response details for debugging
    const data = await response.json();
    console.log("Response from Cashfree:", data);

    if (!response.ok) {
      console.error('Cashfree create-order error:', data);
      // data.message or data.error may contain details from Cashfree
      return res.status(response.status).json({ error: data.message || 'Cashfree order creation failed.' });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('Error creating Cashfree order:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
