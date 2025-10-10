import express from "express";
import axios from "axios";
import Airtable from "airtable";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors()); // allow cross-origin requests from frontend

// Airtable setup
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE);
const table = base(process.env.AIRTABLE_TABLE);

// ----------------- TEST ROUTE -----------------
app.get("/test", (req, res) => {
  res.json({
    ok: true,
    message: "PAYCONNECT backend is live 🎉",
    env: {
      BULKCLIX_API_KEY: process.env.BULKCLIX_API_KEY ? "✅ Loaded" : "❌ Missing",
      AIRTABLE_API_KEY: process.env.AIRTABLE_API_KEY ? "✅ Loaded" : "❌ Missing",
      HUBTEL_CLIENT_ID: process.env.HUBTEL_CLIENT_ID ? "✅ Loaded" : "❌ Missing",
      HUBTEL_CLIENT_SECRET: process.env.HUBTEL_CLIENT_SECRET ? "✅ Loaded" : "❌ Missing"
    }
  });
});

// ----------------- START CHECKOUT -----------------
// Generates BulkClix payment link
app.post("/api/start-checkout", async (req, res) => {
  try {
    const { email, phone, recipient, dataPlan, amount } = req.body;

    if (!phone || !recipient || !dataPlan || !amount) {
      return res.status(400).json({ ok: false, error: "Missing required fields" });
    }

    // Generate temporary Order ID
    const orderId = "T" + Math.floor(Math.random() * 1e15);

    // Call BulkClix API to generate payment link
    const response = await axios.post(
      "https://bulkclix.com/api/payment",
      {
        amount,
        phone,
        email,
        orderId,
        description: `Purchase of ${dataPlan} for ${recipient}`
      },
      { headers: { Authorization: `Bearer ${process.env.BULKCLIX_API_KEY}` } }
    );

    const paymentLink = response.data?.paymentLink;

    if (!paymentLink) {
      return res.status(500).json({ ok: false, error: "Failed to generate payment link" });
    }

    res.json({ ok: true, orderId, paymentLink });

  } catch (err) {
    console.error("Start Checkout Error:", err.response?.data || err.message);
    res.status(500).json({ ok: false, error: err.response?.data || err.message });
  }
});

// ----------------- PAYMENT WEBHOOK -----------------
// Called by BulkClix after payment confirmation
app.post("/api/payment-webhook", async (req, res) => {
  try {
    const { orderId, email, phone, recipient, dataPlan, amount } = req.body;

    if (!orderId || !phone || !recipient || !dataPlan || !amount) {
      return res.status(400).json({ ok: false, error: "Missing required payment data" });
    }

    // 1️⃣ Create Airtable record after confirmed payment
    const airtableRecord = await table.create([
      {
        fields: {
          "Order ID": orderId,
          "Customer Email": email || "",
          "Customer Phone": phone,
          "Data Recipient Number": recipient,
          "Data Plan": dataPlan,
          "Amount": amount,
          "Status": "Pending",
          "Hubtel Sent": true,
          "Hubtel Response": "",
          "BulkClix Response": ""
        }
      }
    ]);

    // 2️⃣ Send SMS via Hubtel to Customer Phone
    const smsContent = `Your data purchase of ${dataPlan} for ${recipient} has been processed and will be delivered in 30 minutes to 4 hours. Order ID: ${orderId}. For support, WhatsApp: 233531300654.`;
    const smsUrl = `https://smsc.hubtel.com/v1/messages/send?clientsecret=${process.env.HUBTEL_CLIENT_SECRET}&clientid=${process.env.HUBTEL_CLIENT_ID}&from=PAYCONNECT&to=${phone}&content=${encodeURIComponent(smsContent)}`;

    const smsResponse = await axios.get(smsUrl);

    // 3️⃣ Update Airtable with Hubtel SMS response
    await table.update(airtableRecord[0].id, {
      "Hubtel Response": JSON.stringify(smsResponse.data)
    });

    res.json({ ok: true, message: "Order added to Airtable & SMS sent" });

  } catch (err) {
    console.error("Payment Webhook Error:", err.response?.data || err.message);
    res.status(500).json({ ok: false, error: err.response?.data || err.message });
  }
});

// ----------------- START SERVER -----------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`PAYCONNECT backend listening on port ${PORT}`));
