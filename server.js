import express from "express";
import axios from "axios";
import Airtable from "airtable";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// Airtable setup
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE);
const table = base(process.env.AIRTABLE_TABLE);

// ✅ Test route to confirm backend + environment variables
app.get("/test", (req, res) => {
  res.json({
    ok: true,
    message: "PAYCONNECT backend is live 🎉",
    env: {
      BULKCLIX_API_KEY: process.env.BULKCLIX_API_KEY ? "✅ Loaded" : "❌ Missing",
      AIRTABLE_API_KEY: process.env.AIRTABLE_API_KEY ? "✅ Loaded" : "❌ Missing",
      HUBTEL_CLIENT_ID: process.env.HUBTEL_CLIENT_ID ? "✅ Loaded" : "❌ Missing"
    }
  });
});

// ✅ Route to handle new orders and initiate BulkClix payment
app.post("/api/order", async (req, res) => {
  try {
    const { orderId, email, phone, recipientNumber, dataPlan, amount, network } = req.body;

    // Store order in Airtable
    const airtableRecord = await table.create([
      {
        fields: {
          "Order ID": orderId || "",
          "Customer Email": email || "",
          "Customer Phone": phone || "",
          "Data Recipient Number": recipientNumber || "",
          "Data Plan": dataPlan || "",
          "Amount": amount || 0,
          "Status": "Pending",
          "Hubtel Sent": true,          // Checkbox
          "Hubtel Response": "",
          "BulkClix Response": ""
        }
      }
    ]);

    // Initiate BulkClix Momo payment
    let bulkResponseData = null;
    try {
      const bulkResponse = await axios.post(
        "https://api.bulkclix.com/api/v1/payment-api/momopay",
        {
          amount,
          phone_number: recipientNumber,
          network: network || "MTN",          // MTN, TELECEL, AIRTELTIGO
          transaction_id: orderId,
          callback_url: process.env.BULKCLIX_CALLBACK_URL || "",
          reference: "PAYCONNECT"
        },
        {
          headers: {
            "Accept": "application/json",
            "x-api-key": process.env.BULKCLIX_API_KEY
          }
        }
      );
      bulkResponseData = bulkResponse.data;
    } catch (bulkError) {
      bulkResponseData = { message: bulkError.response?.data?.message || bulkError.message };
    }

    res.json({
      ok: true,
      message: "Order created successfully",
      airtable: airtableRecord,
      bulk: bulkResponseData
    });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    });
  }
});

// ✅ Webhook route to receive BulkClix payment status
app.post("/api/bulkclix-webhook", async (req, res) => {
  try {
    const { transaction_id, status, phone_number, amount, ext_transaction_id } = req.body;

    // Find Airtable record by Order ID (transaction_id)
    const records = await table.select({
      filterByFormula: `{Order ID} = '${transaction_id}'`
    }).firstPage();

    if (records.length > 0) {
      const record = records[0];

      // Update Airtable with payment status
      await table.update(record.id, {
        "BulkClix Response": JSON.stringify({ status, ext_transaction_id }),
        "Status": status === "success" ? "Completed" : "Failed"
      });
    }

    res.json({ ok: true, message: "Webhook processed successfully" });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ✅ Default Render port setup
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`PAYCONNECT server listening on port ${PORT}`);
});
