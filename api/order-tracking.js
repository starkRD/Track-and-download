const express = require('express');
const router = express.Router();

// Utility: Compare emails (case-insensitive)
function isValidEmail(provided, actual) {
  return provided && actual &&
         provided.trim().toLowerCase() === actual.trim().toLowerCase();
}

// Utility: Calculate delivery deadline (in hours) based on variant
function calculateDeadline(variantId, createdAt) {
  const deliveryHours = {
    premium: 30,
    beast: 24,
    standard: 48,
    basic: 120,
  };
  const hours = deliveryHours[variantId.toLowerCase()] || 48;
  const deadline = new Date(createdAt);
  deadline.setHours(deadline.getHours() + hours);
  return deadline;
}

// Stub: Fetch order details from Shopify using orderId
async function fetchShopifyOrder(orderId) {
  // In a real implementation, replace with an API call to Shopify Admin.
  return {
    id: orderId,
    name: `Order ${orderId}`,
    created_at: new Date().toISOString(),
    fulfillment_status: 'fulfilled', // or null if processing
    variant_id: 'premium',
    customer: { email: 'customer@example.com' }
  };
}

// Stub: Retrieve song data from Google Sheets using orderId
async function getSongData(orderId) {
  // Replace with Google Sheets API call
  if (orderId === 'song-ready') {
    return { mp3Link: 'https://example.com/song.mp3' };
  }
  return null;
}

router.post('/api/order-tracking', async (req, res) => {
  try {
    const { orderId, email: providedEmail } = req.body;

    // Fetch order details from Shopify
    const order = await fetchShopifyOrder(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    // Validate email, if provided
    if (providedEmail && !isValidEmail(providedEmail, order.customer.email)) {
      return res.status(401).json({ error: 'Email verification failed.' });
    }

    // Calculate deadline
    const deadline = calculateDeadline(order.variant_id, order.created_at);
    const now = new Date();

    // Check song readiness
    const songData = await getSongData(order.id);
    const isSongReady = Boolean(songData);
    const mp3Link = songData ? songData.mp3Link : null;

    // Decide response message
    let message = '';
    if (!order.fulfillment_status) {
      message = `Processing – expected by ${deadline.toLocaleString()}`;
    } else if (order.fulfillment_status === 'fulfilled' && !isSongReady) {
      message = 'Delivered';
    } else if (isSongReady && now > deadline) {
      message = providedEmail ? 'Song ready for download.' : 'Please verify your email to download your song.';
    } else if (isSongReady && now <= deadline) {
      message = 'Song available for early access at ₹499.';
    } else {
      message = 'Status updating...';
    }

    // Return response
    res.json({
      order,
      isSongReady,
      mp3Link,
      message,
      deadline
    });
  } catch (error) {
    console.error('Error in order-tracking:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
