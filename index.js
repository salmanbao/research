const express = require("express");
const { hexToUtf8 } = require("@iota/sdk");
const { storeData, queryData } = require("./utils/iota");
const { verifyTx } = require("./utils/tendermint");

const app = express();

const PORT = 3000;

// Middleware to parse JSON requests
app.use(express.json());

// Endpoint to store IoT data
app.post("/store", async (req, res) => {
  const { tag, data } = req.body;
  if (!tag || !data)
    return res.status(400).json({ error: "Missing body attributes" });
  const { blockId, timestamp } = await storeData(tag, data);
  blockId == undefined
    ? res.status(500).json({
        message: "Establishing connection with IOTA Node...",
      })
    : res.json({
        message: `${tag} IoT device's data stored successfully!`,
        timestamp,
        blockId,
      });
});

// Endpoint to verify IoT data
app.get("/query", async (req, res) => {
  const { tag, blockId } = req.query;
  if (!tag || !blockId)
    return res.status(400).json({ error: "Missing query parameters" });
  const data = await queryData(tag, blockId);
  if (!data) return res.status(400).json({ error: "Invalid tagged id" });
  if (!data.payload) res.status(404);
  res.json(data.payload ? JSON.parse(hexToUtf8(data.payload.data)) : {});
});

// Endpoint to verify IoT data
app.get("/verify", async (req, res) => {
  const { timestamp, blockId } = req.query;
  if (!timestamp || !blockId)
    return res.status(400).json({ error: "Missing query parameters" });
  res.json({ isVerified: await verifyTx(timestamp, blockId) });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
