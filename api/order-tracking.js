// pages/api/order-tracking.js
import { google } from 'googleapis';
import Shopify from 'shopify-api-node';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ error: 'Missing order ID or email.' });
  }

  let shopifyOrder = null;
  let customerEmail = "";
  
  try {
    const shopify = new Shopify({
      shopName: process.env.SHOPIFY_STORE,
      accessToken: process.env.SHOPIFY_ADMIN_TOKEN,
    });

    // Same original logic for searching by order name, numeric ID, or email
    const nameQuery = query.startsWith("#") ? query : `#${query}`;
    const orders = await shopify.order.list({ name: nameQuery, limit: 1 });
    
    if (orders.length > 0) {
      shopifyOrder = orders[0];
    } else if (!isNaN(Number(query))) {
      try {
        shopifyOrder = await shopify.order.get(Number(query));
      } catch (idError) {
        console.log("Order ID lookup failed:", idError.message);
      }
    }
    
    if (!shopifyOrder && query.includes('@')) {
      try {
        const emailOrders = await shopify.order.list({ email: query.toLowerCase(), limit: 1 });
        if (emailOrders.length > 0) {
          shopifyOrder = emailOrders[0];
        }
      } catch (emailError) {
        console.log("Email lookup failed:", emailError.message);
      }
    }

    if (!shopifyOrder) {
      return res.status(404).json({ error: 'Order not found. Please check the order number or email and try again.' });
    }
    
    customerEmail = (shopifyOrder.email || "").trim().toLowerCase();
    
  } catch (err) {
    console.error("Shopify error:", err);
    return res.status(500).json({ error: 'We encountered an issue connecting to our order system. Please try again later.' });
  }

  // Lookup in Google Sheet (same as your original)
  let isSongReady = false;
  let mp3Link = null;
  const orderName = shopifyOrder.name.replace('#', '');
  
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.SHEET_ID;
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Sheet1!A2:E',
    });
    
    const rows = response.data.values || [];
    for (const row of rows) {
      if (row.length >= 5) {
        const orderId = (row[1] || "").trim();
        if (orderId === orderName || orderId === query.trim()) {
          isSongReady = (row[4] || "").toLowerCase() === "yes";
          mp3Link = row[3] || null;
          break;
        }
      }
    }
  } catch (err) {
    console.error("Google Sheets error:", err);
    // Don't fail the request; just continue with isSongReady=false, mp3Link=null
  }

  // =========================
  // NEW: Minimal logic for the 2 requested changes
  // 1) If order is fulfilled => check sheet. If found => provide link; if not => "Delivered"
  // 2) If expected delivery date is passed => show "Song ready" or provide link if the sheet says "ready"
  // 3) Download possible only after email verification (handled by front end).
  // =========================

  // We'll keep your original code's approach for returning everything at the end,
  // but we add a new field "statusOverride" for the front end to interpret if needed.
  // Or you can simply modify your existing fields if you prefer.

  // We'll assume "5 days" after created_at as the "expected delivery" threshold.
  const createdAt = new Date(shopifyOrder.created_at);
  const expectedDeliveryDate = new Date(createdAt);
  expectedDeliveryDate.setDate(createdAt.getDate() + 5);

  // We'll define a new variable:
  let statusOverride = ""; // empty means "use your normal flow"

  const now = new Date();

  // 1) If fulfilled:
  if (shopifyOrder.fulfillment_status === "fulfilled") {
    if (isSongReady && mp3Link) {
      // Provide link, but only after email verification in front end
      statusOverride = "Fulfilled + SongReady";
    } else {
      // Show "Delivered" if the sheet doesn't have the link
      statusOverride = "Delivered";
    }
  }
  // 2) Else if expected delivery date has passed:
  else if (now > expectedDeliveryDate) {
    if (isSongReady && mp3Link) {
      statusOverride = "Song ready";
    } else {
      // Show "Song ready" even if it's not in the sheet, as you requested
      statusOverride = "Song ready";
    }
  }
  // Otherwise fallback
  else {
    // fallback to the normal Shopify fulfillment status or "unfulfilled"
    statusOverride = shopifyOrder.fulfillment_status || "unfulfilled";
  }

  // Return same data you used to return, plus our new "statusOverride" field
  return res.status(200).json({
    // The same original fields
    isFulfilled: shopifyOrder.fulfillment_status === "fulfilled",
    isSongReady,
    mp3Link,
    emailFromShopify: customerEmail,
    order: {
      name: shopifyOrder.name,
      id: shopifyOrder.id,
      created_at: shopifyOrder.created_at,
      fulfillment_status: shopifyOrder.fulfillment_status,
      email: customerEmail,
      line_items: shopifyOrder.line_items.map(i => ({ variant_id: i.variant_id })),
    },
    // Minimal addition:
    statusOverride
  });
}
