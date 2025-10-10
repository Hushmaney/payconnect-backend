import express from "express";
import axios from "axios";
import Airtable from "airtable";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// ✅ Airtable setup
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

// ✅ Create new order route
app.post("/api/order", async (req, res) => {
  try {
    const { orderId, email, phone, recipientNumber, dataPlan, amount } = req.body;

    // ✅ Prevent empty fields
    if (!orderId || !email || !phone || !recipientNumber || !dataPlan || !amount) {
      return res.status(400).json({
        ok: false,
        error: "Missing required fields in request body"
      });
    }

    // ✅ Check for duplicate order in Airtable
    const existingOrders = await table.select({
      filterByFormula: `{Order ID} = "${orderId}"`
    }).firstPage();

    if (existingOrders.length > 0) {
      return res.status(409).json({
        ok: false,
        message: "Duplicate order — this Order ID already exists"
      });
    }

    // ✅ Create record in Airtable
    const airtableRecord = await table.create([
      {
        fields: {
          "Order ID": orderId,
          "Customer Email": email,
          "Customer Phone": phone,
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

    // ✅ Call Bulkclix API (optional)
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

    // ✅ Success response
    res.json({
      ok: true,
      message: "Order created successfully",
      airtable: airtableRecord,
      bulk: bulkResponse.data
    });
  } catch (error) {
    console.error("❌ Error:", error.response?.data || error.message);
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
