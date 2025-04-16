// pages/api/get-song.js
import { GoogleSpreadsheet } from "google-spreadsheet";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { orderId } = req.query;
  if (!orderId) {
    res.status(400).json({ error: "Missing orderId parameter." });
    return;
  }

  try {
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
    await doc.useServiceAccountAuth({
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    });
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle["Uploads"];
    const rows = await sheet.getRows();
    const row = rows.find((r) => r.OrderID === orderId && r.Status === "Ready");

    if (row && row.FileURL) {
      res.status(200).json({ ready: true, fileUrl: row.FileURL });
    } else {
      res.status(200).json({ ready: false });
    }
  } catch (error) {
    console.error("Error accessing Google Sheet:", error);
    res.status(500).json({ error: "Server error." });
  }
}
