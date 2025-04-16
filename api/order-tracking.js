{% comment %}
Enhanced Order Tracking Page
- Displays standard tracking details.
- Shows a download button only if:
  • Shopify order is fulfilled,
  • The song is ready (Google Sheet flag is "yes"),
  • A valid MP3 (Google Drive) link exists.
{% endcomment %}

<!-- Container -->
<div class="order-tracking-container">
  <h2>Track Your Order</h2>
  <p>Enter your Order ID or Email to check your order status.</p>
  
  <!-- Input & Button -->
  <div class="input-container">
    <input type="text" id="orderInput" placeholder="Enter Order ID or Email">
    <button onclick="trackOrder()">Track Order</button>
  </div>
  
  <!-- Status & Delivery Info -->
  <div id="orderStatus"></div>
  
  <!-- Vertical Timeline -->
  <div class="timeline-container" id="timelineContainer" style="display:none;">
    <!-- Timeline Steps -->
    <div class="timeline-step" data-stage="Order Received">
      <div class="icon-container">
        <i class="fas fa-check"></i>
      </div>
      <div class="step-line"></div>
      <div class="step-content">
        <h4>Order Received</h4>
        <p>We have received your request.</p>
      </div>
    </div>
    
    <div class="timeline-step" data-stage="Lyrics Composition">
      <div class="icon-container">
        <i class="fas fa-music"></i>
      </div>
      <div class="step-line"></div>
      <div class="step-content">
        <h4>Lyrics Composition</h4>
        <p>Our team is crafting your custom lyrics.</p>
      </div>
    </div>
    
    <div class="timeline-step" data-stage="Song Production">
      <div class="icon-container">
        <i class="fas fa-headphones"></i>
      </div>
      <div class="step-line"></div>
      <div class="step-content">
        <h4>Song Production</h4>
        <p>Your song is being produced.</p>
      </div>
    </div>
    
    <div class="timeline-step" data-stage="Final Editing">
      <div class="icon-container">
        <i class="fas fa-edit"></i>
      </div>
      <div class="step-line"></div>
      <div class="step-content">
        <h4>Final Editing</h4>
        <p>We're putting on the finishing touches.</p>
      </div>
    </div>
    
    <div class="timeline-step" data-stage="Order Ready">
      <div class="icon-container">
        <i class="fas fa-gift"></i>
      </div>
      <div class="step-line"></div>
      <div class="step-content">
        <h4>Order Ready</h4>
        <p>Your song is complete, and you will receive it any minute now!</p>
      </div>
    </div>
    
    <!-- WhatsApp Button -->
    <div class="whatsapp-container">
      <a href="https://wa.me/7017706038" target="_blank" class="whatsapp-button">
        Contact us on WhatsApp
      </a>
    </div>
  </div>
</div>

<script>
// Replace with your deployed VERCEL endpoint URL
const VERCEL_ENDPOINT = 'https://shopify-order-tracking.vercel.app/api/order-tracking';

// Variant timelines for updating tracking progress
const variantTimelines = [
  { name: "Basic", ids: ["41290369269835"], hours: 240 }, // 10 days
  { name: "Standard", ids: ["41290369302603", "41274164510795"], hours: 120 }, // 5 days
  { name: "Premium", ids: ["41290369335371"], hours: 30 },
  { name: "Beast", ids: ["41290369368139"], hours: 30 },
  { name: "FAST", ids: ["41274164543563"], hours: 48 },
  { name: "EXPRESS", ids: ["41274164576331"], hours: 24 }
];

async function trackOrder() {
  const orderInput = document.getElementById("orderInput").value.trim();
  const statusContainer = document.getElementById("orderStatus");
  const timelineContainer = document.getElementById("timelineContainer");
  
  if (!orderInput) {
    statusContainer.innerHTML = "<p style='color:red;'>Please enter an Order ID or Email.</p>";
    return;
  }
  
  statusContainer.innerHTML = "<p>Fetching order details...</p>";
  timelineContainer.style.display = "none";
  
  try {
    const response = await fetch(`${VERCEL_ENDPOINT}?query=${encodeURIComponent(orderInput)}`);
    const data = await response.json();

    // Log debug info to verify returned values
    console.log("DEBUG order data:", data);
    
    if (data.error) {
      statusContainer.innerHTML = `<p style='color:red;'>${data.error}</p>`;
      return;
    }
    
    if (!data.order || !data.order.created_at) {
      statusContainer.innerHTML = "<p style='color:red;'>Order details not found.</p>";
      return;
    }
    
    const fulfillmentStatus = data.order.fulfillment_status || "";
    const orderId = data.order.name;
    
    // Calculate tracking timeline info
    const timelineHours = getDeliveryTimeline(data.order);
    let orderStatus = getOrderStatus(data.order, timelineHours);
    if (fulfillmentStatus.toLowerCase() === "fulfilled") {
      orderStatus = "fulfilled";
    }
    
    const deliveryDateString = getExpectedDeliveryDate(data.order, timelineHours);
    const orderDate = new Date(data.order.created_at);
    const orderDateString = orderDate.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
    
    // Display general tracking details
    statusContainer.innerHTML = `
      <p>Order ID: <strong>${orderId}</strong></p>
      <p>Order Date: <strong>${orderDateString}</strong></p>
      <p>Status: <strong>${orderStatus}</strong></p>
      <p>Expected Delivery: <strong>${deliveryDateString}</strong></p>
    `;
    
    updateTimeline(orderStatus, fulfillmentStatus);
    timelineContainer.style.display = "block";
    
    // Debug output to check conditions for download button
    console.log("DEBUG: isFulfilled:", data.isFulfilled, "isSongReady:", data.isSongReady, "mp3Link:", data.mp3Link);
    if (data.isFulfilled && data.isSongReady && data.mp3Link) {
      const shopifyEmail = data.emailFromShopify || "";
      const maskedEmail = shopifyEmail.replace(/(.).+(@.+)/, "$1***$2");
      statusContainer.innerHTML += `
        <p style="color:green; font-weight:bold;">
          Your song is ready! (Email verified as <em>${maskedEmail}</em>)
        </p>
        <a href="${data.mp3Link}" target="_blank" class="download-button">
          Download Song
        </a>
      `;
    }
    
  } catch (error) {
    statusContainer.innerHTML = "<p style='color:red;'>Error fetching order details. Please try again later.</p>";
    console.error("Error:", error);
  }
}

/**
 * Returns the delivery timeline (in hours) based on variant IDs in the order.
 */
function getDeliveryTimeline(order) {
  let matchedHours = [];
  if (order.line_items && order.line_items.length > 0) {
    order.line_items.forEach(item => {
      const variantId = String(item.variant_id);
      variantTimelines.forEach(variant => {
        if (variant.ids.includes(variantId)) {
          matchedHours.push(variant.hours);
        }
      });
    });
  }
  return matchedHours.length > 0 ? Math.min(...matchedHours) : 240;
}

/**
 * Determines the current order status based on elapsed time.
 */
function getOrderStatus(order, timelineHours) {
  const createdAt = new Date(order.created_at);
  const now = new Date();
  const elapsedHours = (now - createdAt) / (1000 * 60 * 60);
  
  const progressStages = [
    "Order Received", 
    "Lyrics Composition", 
    "Song Production", 
    "Final Editing", 
    "Order Ready"
  ];
  
  let progressIndex = 0;
  if (elapsedHours >= timelineHours) {
    progressIndex = 4;
  } else if (elapsedHours > timelineHours * 0.8) {
    progressIndex = 3;
  } else if (elapsedHours > timelineHours * 0.5) {
    progressIndex = 2;
  } else if (elapsedHours > timelineHours * 0.2) {
    progressIndex = 1;
  }
  
  return progressStages[progressIndex];
}

/**
 * Calculates and returns the expected delivery date string.
 */
function getExpectedDeliveryDate(order, timelineHours) {
  const createdAt = new Date(order.created_at);
  const deliveryTimestamp = createdAt.getTime() + timelineHours * 60 * 60 * 1000;
  const deliveryDate = new Date(deliveryTimestamp);
  return deliveryDate.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

/**
 * Updates the timeline steps based on the current stage.
 */
function updateTimeline(currentStage, fulfillmentStatus = "") {
  const steps = document.querySelectorAll('.timeline-step');
  const progressStages = [
    "Order Received", 
    "Lyrics Composition", 
    "Song Production", 
    "Final Editing", 
    "Order Ready"
  ];
  
  let stageIndex;
  if (fulfillmentStatus.toLowerCase() === "fulfilled") {
    stageIndex = progressStages.length - 1;
  } else {
    stageIndex = progressStages.indexOf(currentStage);
  }
  
  steps.forEach((step, i) => {
    step.classList.toggle('active', i <= stageIndex);
  });
}
</script>

<style>
.order-tracking-container {
  text-align: center;
  padding: 20px;
  max-width: 500px;
  margin: auto;
  font-family: Arial, sans-serif;
}

.input-container {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-bottom: 20px;
}

input {
  padding: 10px;
  width: 250px;
  font-size: 16px;
  border: 3px solid #ccc;
  border-radius: 4px;
}

button {
  padding: 10px 15px;
  cursor: pointer;
  background-color: #4CAF50;
  color: white;
  border: none;
  border-radius: 4px;
  transition: background-color 0.3s;
}

button:hover {
  background-color: #45a049;
}

#orderStatus p {
  margin: 0.5em 0;
  font-size: 1em;
}

/* Timeline Container */
.timeline-container {
  margin-top: 20px;
  position: relative;
}

/* Timeline Step */
.timeline-step {
  display: flex;
  position: relative;
  margin: 20px 0;
  align-items: flex-start;
}

/* Icon Container */
.icon-container {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: #ccc;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  flex-shrink: 0;
  font-size: 1.2em;
}

/* Vertical Line */
.step-line {
  position: absolute;
  left: 19px;
  top: 40px;
  width: 2px;
  background-color: #ccc;
  height: 100%;
  z-index: 1;
}
.timeline-step:last-child .step-line {
  height: 40px;
}

/* Content Box */
.step-content {
  background-color: #f9f9f9;
  margin-left: 10px;
  padding: 10px 15px;
  border-radius: 4px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  text-align: left;
  min-width: 200px;
}

.step-content h4 {
  margin: 0 0 5px;
  color: #333;
}

.step-content p {
  margin: 0;
  font-size: 0.9em;
  color: #666;
}

/* Active Step Styling */
.timeline-step.active .icon-container {
  background-color: #4CAF50;
}

.timeline-step.active .step-line {
  background-color: #4CAF50;
}

/* WhatsApp Button */
.whatsapp-container {
  margin-top: 30px;
  text-align: center;
}

.whatsapp-button {
  display: inline-block;
  padding: 10px 20px;
  background-color: #25D366;
  color: #fff;
  text-decoration: none;
  border-radius: 4px;
  font-weight: bold;
  transition: background-color 0.3s;
}

.whatsapp-button:hover {
  background-color: #1ebe57;
}

/* Download Button Styling */
.download-button {
  display: inline-block;
  padding: 10px 20px;
  background-color: #007acc;
  color: #fff;
  text-decoration: none;
  border-radius: 4px;
  font-weight: bold;
  margin-top: 10px;
}

.download-button:hover {
  background-color: #005fa3;
}

/* Mobile Responsive */
@media (max-width: 600px) {
  .order-tracking-container {
    padding: 10px;
  }
  .input-container {
    flex-direction: column;
    gap: 5px;
  }
  input {
    width: 100%;
  }
  .step-content {
    min-width: auto;
    margin-left: 15px;
  }
}
</style>
