// pages/api/create-order.js

import fetch from 'node-fetch'; // If using Node 18+, you can use the built-in fetch instead.

export default async function handler(req, res) {
  // Handle preflight requests (CORS)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  
  // Destructure and validate incoming fields
  const { orderId, amount, customerName, customerEmail, customerPhone } = req.body;
  
  if (!orderId || !amount || !customerName || !customerEmail || !customerPhone) {
    return res.status(400).json({ error: 'Missing required payment fields.' });
  }
  
  try {
    // Set CORS headers for the response
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Convert amount to a number
    const numericAmount = parseFloat(amount);

    // Generate a unique customerId if not provided in your data.
    const customerId = generateCustomerId();

    // Build payload with the required field names (camelCase)
    const payload = {
      orderId: orderId,               // Unique Order ID for Cashfree
      orderAmount: numericAmount,     // Payment amount as a number
      orderCurrency: 'INR',
      customerDetails: {
        customerId,                   // Generated customer ID
        customerName,                 // Customer's name
        customerEmail,                // Customer's email
        customerPhone               // Customer's phone number
      }
    };

    // Log payload for debugging (remove before production if needed)
    console.log("Payload sent to Cashfree:", payload);

    // Call Cashfree's production endpoint (update URL if using sandbox)
    const response = await fetch('https://api.cashfree.com/api/v2/cftoken/order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log("Response from Cashfree:", data);

    if (!response.ok) {
      console.error('Cashfree create-order error:', data);
      return res.status(response.status).json({ error: data.message || 'Cashfree order creation failed.' });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('Error creating Cashfree order:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

function generateCustomerId() {
  // Generate a unique customer ID using current timestamp and a random number.
  return "cust_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
}
