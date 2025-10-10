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

// ✅ Example route to handle new orders (update with your logic)
app.post("/api/order", async (req, res) => {
  try {
    const { orderId, email, phone, recipientNumber, dataPlan, amount } = req.body;

    // Store in Airtable
    const airtableRecord = await table.create([
      {
        fields: {
          "Order ID": orderId,
          "Customer Email": email,
          "Customer phone": phone,
          "Data Recipient Number": recipientNumber,
          "Data Plan": dataPlan,
          "Amount": amount,
          "Status": "Pending",
          "Hubtel sent": "No",
          "Hubtel Response": "",
          "Bulkclix Response": ""
        }
      }
    ]);

    // Call Bulkclix API (optional)
    const bulkResponse = await axios.post(
      "https://app.bulkclix.com/api/momo/collection",
      {
        merchant_id: process.env.BULKCLIX_MERCHANT,
        api_key: process.env.BULKCLIX_API_KEY,
        amount,
        customer_number: recipientNumber,
        reference: orderId
      }
    );

    res.json({
      ok: true,
      message: "Order created successfully",
      airtable: airtableRecord,
      bulk: bulkResponse.data
    });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    });
  }
});

// ✅ Default Render port setup
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`PAYCONNECT server listening on port ${PORT}`);
});
