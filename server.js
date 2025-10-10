// PAYCONNECT v2 server.js
require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const {
  BULKCLIX_API_KEY,
  BULKCLIX_MERCHANT,
  HUBTEL_CLIENT_ID,
  HUBTEL_CLIENT_SECRET,
  HUBTEL_SENDER,
  AIRTABLE_API_KEY,
  AIRTABLE_BASE,
  AIRTABLE_TABLE,
  PORT = 3000
} = process.env;

if (!AIRTABLE_API_KEY || !AIRTABLE_BASE || !AIRTABLE_TABLE) {
  console.warn('Airtable env vars missing; please set AIRTABLE_API_KEY, AIRTABLE_BASE, AIRTABLE_TABLE in .env');
}

/* Utility: create Airtable record */
async function createAirtableRecord(order) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AIRTABLE_TABLE)}`;
  const body = {
    fields: {
      "Order ID": order.orderId,
      "Data Plan": order.dataPlan || '',
      "Amount": Number(order.amount) || 0,
      "Customer Phone": order.phone || '',
      "Data Recipient Number": order.recipient || '',
      "Transaction ID": order.transactionId || '',
      "Status": order.status || 'Pending'
    }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  return data;
}

/* Utility: send Hubtel SMS */
async function sendHubtelSMS(to, message) {
  let toNormalized = to;
  if (/^0\d{9}$/.test(to)) toNormalized = '233' + to.slice(1);
  if (/^\d{9}$/.test(to)) toNormalized = '233' + to;

  const content = encodeURIComponent(message);
  const url = `https://smsc.hubtel.com/v1/messages/send?clientsecret=${encodeURIComponent(HUBTEL_CLIENT_SECRET)}&clientid=${encodeURIComponent(HUBTEL_CLIENT_ID)}&from=${encodeURIComponent(HUBTEL_SENDER)}&to=${encodeURIComponent(toNormalized)}&content=${content}`;

  const res = await fetch(url, { method: 'GET' });
  const json = await res.json().catch(()=>({ raw: 'non-json response' }));
  return json;
}

/* Start checkout: called by frontend */
app.post('/api/start-checkout', async (req, res) => {
  try {
    const { email, phone, recipient, dataPlan, amount } = req.body;
    if (!phone || !recipient || !dataPlan || !amount) return res.status(400).json({ error: 'Missing required fields' });

    // generate our own order and transaction ids
    const orderId = 'T' + Date.now().toString(36) + Math.floor(Math.random()*10000).toString();
    const transactionId = Date.now().toString(); // BulkClix expects a transaction_id field (string)

    // prepare BulkClix payload
    // network must be one of MTN, TELECEL, AIRTELTIGO -> infer from dataPlan prefix
    let network = 'MTN';
    if (dataPlan.toLowerCase().startsWith('telecel')) network = 'TELECEL';
    if (dataPlan.toLowerCase().startsWith('airtel')) network = 'AIRTELTIGO';

    const bulkPayload = {
      amount: Number(amount),
      phone_number: phone.replace(/\+/, ''), // send local format
      network: network,
      transaction_id: transactionId,
      callback_url: `${req.protocol}://${req.get('host')}/api/bulkclix/webhook`,
      reference: "PAYCONNECT"
    };

    // Create Airtable record (status Pending) BEFORE initiating payment
    const order = { orderId, dataPlan, amount, phone, recipient, transactionId, status: 'Pending' };
    const airtableRes = await createAirtableRecord(order);

    // Call BulkClix momopay endpoint
    const bulkRes = await fetch('https://api.bulkclix.com/api/v1/payment-api/momopay', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'x-api-key': BULKCLIX_API_KEY
      },
      body: JSON.stringify(bulkPayload)
    });
    const bulkJson = await bulkRes.json().catch(()=>({ error: 'invalid JSON from BulkClix' }));

    // respond to frontend; app will redirect user to glide page
    return res.json({ ok:true, bulk: bulkJson, airtable: airtableRes });
  } catch (err) {
    console.error('start-checkout error', err);
    return res.status(500).json({ error: String(err) });
  }
});

/* BulkClix webhook receiver */
app.post('/api/bulkclix/webhook', async (req, res) => {
  try {
    const body = req.body || req;
    console.log('BulkClix webhook received:', body);

    // expected: { amount, status, transaction_id, ext_transaction_id, phone_number }
    const transactionId = body.transaction_id || body?.data?.transaction_id || body?.data?.ext_transaction_id;
    const status = (body.status || '').toLowerCase();

    if (!transactionId) {
      console.warn('No transaction_id in webhook payload');
      return res.status(400).json({ ok:false, error:'No transaction_id' });
    }

    // Find Airtable record by Transaction ID
    const airtableSearchUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AIRTABLE_TABLE)}?filterByFormula=${encodeURIComponent("{Transaction ID} = '" + transactionId + "'")}`;
    const searchRes = await fetch(airtableSearchUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` } });
    const searchJson = await searchRes.json();
    const record = (searchJson.records && searchJson.records[0]) || null;

    // If payment success, send SMS via Hubtel and update Hubtel fields in Airtable.
    if (status && status.includes('success')) {
      // Prepare SMS: use Data Plan and recipient from Airtable record if available
      const dataPlan = record?.fields?.['Data Plan'] || '';
      const recipient = record?.fields?.['Data Recipient Number'] || body.phone_number || '';
      const orderId = record?.fields?.['Order ID'] || '';
      const customerPhone = record?.fields?.['Customer Phone'] || body.phone_number || '';

      const smsMsg = `Your data purchase of ${dataPlan} for ${recipient} has been processed and will be delivered in 30 minutes to 4 hours. Order ID: ${orderId}. For support, WhatsApp: 233531300654.`;
      let hubRes = {};
      try {
        hubRes = await sendHubtelSMS(customerPhone, smsMsg);
      } catch (e) {
        hubRes = { error: String(e) };
      }

      // Update Airtable record: set Hubtel Sent true and save response, keep Status as Pending
      if (record && record.id) {
        const updateUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AIRTABLE_TABLE)}/${record.id}`;
        const updBody = {
          fields: {
            "Hubtel Sent": true,
            "Hubtel Response": typeof hubRes === 'object' ? JSON.stringify(hubRes) : String(hubRes)
          }
        };
        await fetch(updateUrl, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(updBody)
        });
      }
      return res.json({ ok:true, hub: hubRes });
    } else {
      // Not success: record the raw webhook in Hubtel Response for debugging
      if (record && record.id) {
        const updateUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AIRTABLE_TABLE)}/${record.id}`;
        const updBody = { fields: { "Hubtel Response": JSON.stringify(body) } };
        await fetch(updateUrl, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(updBody)
        });
      }
      return res.json({ ok:true, message:'received' });
    }
  } catch (err) {
    console.error('webhook error', err);
    return res.status(500).json({ error: String(err) });
  }
});

app.get('/health', (req,res)=> res.send('ok'));

app.listen(PORT, ()=> console.log(`PAYCONNECT server listening on port ${PORT}`));
