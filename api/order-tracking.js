// pages/api/order-tracking.js
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { query } = req;
  const orderQuery = query.query;

  if (!orderQuery) {
    res.status(400).json({ error: "Missing query parameter." });
    return;
  }

  const isEmail = orderQuery.includes("@");
  const shopifyStore = process.env.SHOPIFY_STORE;
  const adminApiAccessToken = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
  let url = `https://${shopifyStore}/admin/api/2023-01/orders.json?status=any`;
  if (isEmail) {
    url += `&email=${encodeURIComponent(orderQuery)}`;
  } else {
    url += `&name=${encodeURIComponent(orderQuery)}`;
  }

  try {
    const response = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": adminApiAccessToken,
        "Content-Type": "application/json",
      },
    });
    const data = await response.json();

    if (!data.orders || data.orders.length === 0) {
      res.status(404).json({ error: "Order not found." });
      return;
    }

    const order = data.orders[0];
    const fullEmail = order.customer ? order.customer.email : "";
    let maskedEmail = "";
    if (fullEmail) {
      const [user, domain] = fullEmail.split("@");
      maskedEmail = user[0] + "***@" + domain;
    }

    res.status(200).json({
      order: {
        created_at: order.created_at,
        name: order.name,
        fulfillment_status: order.fulfillment_status,
        line_items: order.line_items.map((item) => ({
          variant_id: item.variant_id,
        })),
      },
      customer: {
        fullEmail, // This value is not displayed to the user.
        maskedEmail,
      },
    });
  } catch (error) {
    console.error("Error fetching order details:", error);
    res.status(500).json({ error: "Server error." });
  }
}
