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
      HUBTEL_CLIENT_ID: process.env.HUBTEL_CLIENT_ID ? "✅ Loaded" : "❌ Missing",
      HUBTEL_CLIENT_SECRET: process.env.HUBTEL_CLIENT_SECRET ? "✅ Loaded" : "❌ Missing"
    }
  });
});

// ✅ Route to handle new orders
app.post("/api/order", async (req, res) => {
  try {
    const { orderId, email, phone, recipient, dataPlan, amount } = req.body;

    // Store in Airtable
    const airtableRecord = await table.create([
      {
        fields: {
          "Order ID": orderId || "",
          "Customer Email": email || "",
          "Customer Phone": phone || "",
          "Data Recipient Number": recipient || "",
          "Data Plan": dataPlan || "",
          "Amount": amount || 0,
          "Status": "Pending",
          "Hubtel Sent": true,
          "Hubtel Response": "",
          "BulkClix Response": ""
        }
      }
    ]);

    // ✅ Hubtel SMS only to Customer Phone
    try {
      const smsUrl = `https://smsc.hubtel.com/v1/messages/send?clientsecret=${process.env.HUBTEL_CLIENT_SECRET}&clientid=${process.env.HUBTEL_CLIENT_ID}&from=PAYCONNECT&to=${phone}&content=${encodeURIComponent(`Your data purchase of ${dataPlan} for ${recipient} has been processed and will be delivered in 30 minutes to 4 hours. Order ID: ${orderId}. For support, WhatsApp: 233531300654.`)}`;

      const smsResponse = await axios.get(smsUrl);

      // Update Airtable record with SMS response
      await table.update(airtableRecord[0].id, {
        "Hubtel Response": JSON.stringify(smsResponse.data)
      });

    } catch (smsError) {
      console.error("Hubtel SMS error:", smsError.response?.data || smsError.message);
    }

    // Optional: BulkClix payment placeholder
    let bulkResponseData = { message: "BulkClix payment placeholder (account not activated)" };

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

// ✅ Default Render port setup
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`PAYCONNECT server listening on port ${PORT}`);
});
