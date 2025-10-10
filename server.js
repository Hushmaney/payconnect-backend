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

// Test route
app.get("/test", (req, res) => {
  res.json({ ok: true, message: "PAYCONNECT backend is live 🎉" });
});

// Start checkout - generates BulkClix payment link
app.post("/api/start-checkout", async (req, res) => {
  try {
    const { email, phone, recipient, dataPlan, amount } = req.body;

    // Generate temporary Order ID
    const orderId = "T" + Math.floor(Math.random() * 1e15);

    // BulkClix API call to generate payment link
    const response = await axios.post(
      "https://bulkclix.com/api/payment",
      { amount, phone, email, orderId, description: `Purchase of ${dataPlan} for ${recipient}` },
      { headers: { Authorization: `Bearer ${process.env.BULKCLIX_API_KEY}` } }
    );

    const paymentLink = response.data.paymentLink;

    res.json({ ok: true, orderId, paymentLink });

  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ ok: false, error: err.response?.data || err.message });
  }
});

// Webhook from BulkClix when payment succeeds
app.post("/api/payment-webhook", async (req, res) => {
  try {
    const { orderId, email, phone, recipient, dataPlan, amount } = req.body;

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
    const smsUrl = `https://smsc.hubtel.com/v1/messages/send?clientsecret=${process.env.HUBTEL_CLIENT_SECRET}&clientid=${process.env.HUBTEL_CLIENT_ID}&from=PAYCONNECT&to=${phone}&content=${encodeURIComponent(`Your data purchase of ${dataPlan} for ${recipient} has been processed and will be delivered in 30 minutes to 4 hours. Order ID: ${orderId}. For support, WhatsApp: 233531300654.`)}`;
    const smsResponse = await axios.get(smsUrl);

    // Update Airtable record with Hubtel response
    await table.update(airtableRecord[0].id, {
      "Hubtel Response": JSON.stringify(smsResponse.data)
    });

    res.json({ ok: true, message: "Order added to Airtable & SMS sent" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`PAYCONNECT backend listening on port ${PORT}`));
