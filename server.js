import express from "express";
import axios from "axios";
import Airtable from "airtable";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors()); // allow cross-origin requests from frontend

// ----------------- AIRTABLE SETUP -----------------
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

// ----------------- START CHECKOUT (BulkClix MOMO) -----------------
app.post("/api/start-checkout", async (req, res) => {
  try {
    const { email, phone, recipient, dataPlan, amount, network } = req.body;

    if (!phone || !recipient || !dataPlan || !amount || !network) {
      return res.status(400).json({ ok: false, error: "Missing required fields" });
    }

    // Generate a unique transaction ID
    const transaction_id = "T" + Math.floor(Math.random() * 1e15);

    // Call BulkClix API to initiate Momo payment
    let response;
    try {
      response = await axios.post(
        "https://api.bulkclix.com/api/v1/payment-api/momopay",
        {
          amount,
          phone_number: phone,
          network, // "MTN", "TELECEL", or "AIRTELTIGO"
          transaction_id,
          callback_url: "https://payconnect-backend.onrender.com/api/payment-webhook",
          reference: "PAYCONNECT"
        },
        {
          headers: {
            "x-api-key": process.env.BULKCLIX_API_KEY,
            "Accept": "application/json"
          },
          timeout: 10000
        }
      );
    } catch (apiErr) {
      console.error("BulkClix API Error:", apiErr.response?.data || apiErr.message);
      return res.status(500).json({
        ok: false,
        error: "BulkClix API error: " + (apiErr.response?.data?.message || apiErr.message)
      });
    }

    // Check BulkClix response
    const apiData = response.data?.data;
    if (!apiData || !apiData.transaction_id) {
      console.error("BulkClix unexpected response:", response.data);
      return res.status(500).json({ ok: false, error: "Failed to initiate BulkClix payment" });
    }

    // ✅ Send successful response back to frontend
    res.json({
      ok: true,
      message: "Payment initiated successfully",
      data: {
        transaction_id: apiData.transaction_id,
        amount: apiData.amount,
        phone: apiData.phone_number,
        status: "pending"
      }
    });

  } catch (err) {
    console.error("Start Checkout Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ----------------- PAYMENT WEBHOOK -----------------
// Called by BulkClix after payment confirmation
app.post("/api/payment-webhook", async (req, res) => {
  try {
    const { amount, status, transaction_id, ext_transaction_id, phone_number } = req.body;

    if (!transaction_id || !phone_number || !amount || !status) {
      return res.status(400).json({ ok: false, error: "Missing payment data" });
    }

    // 1️⃣ Create Airtable record after confirmed payment
    const airtableRecord = await table.create([
      {
        fields: {
          "Order ID": transaction_id,
          "Customer Phone": phone_number,
          "Data Recipient Number": phone_number,
          "Data Plan": "Unknown",
          "Amount": amount,
          "Status": status,
          "Hubtel Sent": true,
          "Hubtel Response": "",
          "BulkClix Response": JSON.stringify(req.body)
        }
      }
    ]);

    // 2️⃣ Send SMS via Hubtel to Customer Phone
    const smsContent = `Your payment of GHS ${amount} has been received successfully. Order ID: ${transaction_id}. Thank you for using PAYCONNECT.`;
    const smsUrl = `https://smsc.hubtel.com/v1/messages/send?clientsecret=${process.env.HUBTEL_CLIENT_SECRET}&clientid=${process.env.HUBTEL_CLIENT_ID}&from=PAYCONNECT&to=${phone_number}&content=${encodeURIComponent(smsContent)}`;

    const smsResponse = await axios.get(smsUrl);

    // 3️⃣ Update Airtable with Hubtel SMS response
    await table.update(airtableRecord[0].id, {
      "Hubtel Response": JSON.stringify(smsResponse.data)
    });

    res.json({ ok: true, message: "Payment received & SMS sent" });

  } catch (err) {
    console.error("Payment Webhook Error:", err.response?.data || err.message);
    res.status(500).json({ ok: false, error: err.response?.data || err.message });
  }
});

// ----------------- CHECK PAYMENT STATUS -----------------
app.get("/api/check-status/:transaction_id", async (req, res) => {
  try {
    const { transaction_id } = req.params;
    const response = await axios.get(
      `https://api.bulkclix.com/api/v1/payment-api/checkstatus/${transaction_id}`,
      {
        headers: {
          "x-api-key": process.env.BULKCLIX_API_KEY,
          "Accept": "application/json"
        }
      }
    );

    res.json({ ok: true, data: response.data });
  } catch (err) {
    console.error("Check Status Error:", err.response?.data || err.message);
    res.status(500).json({ ok: false, error: err.response?.data || err.message });
  }
});

// ----------------- START SERVER -----------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`PAYCONNECT backend listening on port ${PORT}`));
