const { createHash } = require("crypto");
const { MerkleTree } = require("merkletreejs");
const {blake3} = require('@noble/hashes/blake3');
const fs = require("fs"); // Only if using Node.js

const TENDERMINT_URL = "http://localhost:26657";

// Cache for block mappings to reduce file I/O
const blockMappingCache = new Map();
const CACHE_FLUSH_INTERVAL = 5000; // 5 seconds
const MAX_PENDING_WRITES = 50; // Force flush after 50 pending writes
let lastCacheFlush = Date.now();

// Batch file writes
let pendingWrites = new Map();
const BATCH_WRITE_INTERVAL = 2000; // 2 seconds

// Initialize batch write interval
setInterval(() => {
  if (pendingWrites.size > 0) {
    flushPendingWrites();
  }
}, BATCH_WRITE_INTERVAL);

async function flushPendingWrites() {
  const fileName = "blockMapping.json";
  let blockMapping = {};

  // Read existing mappings
  try {
    const fileContent = fs.readFileSync(fileName, "utf8");
    blockMapping = JSON.parse(fileContent);
  } catch (err) {
    blockMapping = {};
  }

  // Merge pending writes
  for (const [blockId, data] of pendingWrites) {
    blockMapping[blockId] = data;
  }

  // Write to file
  try {
    fs.writeFileSync(fileName, JSON.stringify(blockMapping, null, 2));
    pendingWrites.clear();
  } catch (err) {
    console.error("Error writing block mappings:", err);
  }
}

function hash(value) {
  return Buffer.from(blake3(new TextEncoder().encode(value))).toString("hex");
  // return createHash("sha256").update(value.toString()).digest("hex");
}

async function fetchTendermintRPC(endpoint) {
  try {
    return await (
      await fetch(`${TENDERMINT_URL}${endpoint}`)
    ).json();
  } catch (error) {
    console.error("Error fetching from Tendermint RPC:", error.message);
    throw error;
  }
}

// Function to query the timed Merkle Tree
async function queryTimedMerkleTree(key) {
  const data = await fetchTendermintRPC(`/abci_query?data="${key}"`);
  return data.result.response.value
    ? new MerkleTree(
        Buffer.from(data.result.response.value, "base64").toString().split(",")
      )
    : null;
}

// Function to broadcast a transaction (Merkle Tree)
async function broadcastTx(blockIds, timestamp) {
  if (!blockIds || blockIds.length === 0) return;
  
  const startTime = Date.now();
  console.log(`[Broadcast] Processing ${blockIds.length} block IDs`);

  try {
    // 1) Build a timestamp-based key
    const timestampKey = new Date(timestamp).toISOString();

    // 2) Build the TX data with optimized hashing
    const hashedIds = await Promise.all(
      blockIds.map(async (x) => hash(x))
    );
    const txData = `${timestampKey}=${hashedIds}`;

    // 3) Send to Tendermint with retry logic
    let result;
    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount < maxRetries) {
      try {
        result = await fetchTendermintRPC(
          `/broadcast_tx_commit?tx="${txData}"`
        );
        break;
      } catch (err) {
        retryCount++;
        if (retryCount === maxRetries) throw err;
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
      }
    }

    // 4) Extract block ID with better error handling
    let blockId = "unknownBlock";
    try {
      blockId = result.result?.height || 
                result.result?.check_tx?.height || 
                result.height || 
                "unknownBlock";
    } catch (err) {
      console.warn("Could not parse block ID from broadcast result:", err);
    }

    // 5) Store mapping with optimized file I/O
    const mappingData = {
      timestampKey,
      validationTime: Date.now(),
      blockIds,
      hashedIds,
      processingTime: Date.now() - startTime
    };

    // Add to pending writes with merge logic
    if (pendingWrites.has(blockId)) {
      const existingData = pendingWrites.get(blockId);
      mappingData.blockIds = [...new Set([...existingData.blockIds, ...blockIds])];
      mappingData.hashedIds = [...new Set([...existingData.hashedIds, ...hashedIds])];
    }
    pendingWrites.set(blockId, mappingData);


    // Force flush if we have too many pending writes
    if (pendingWrites.size >= MAX_PENDING_WRITES) {
      console.log(`[Broadcast] Forcing flush due to pending writes (${pendingWrites.size})`);
      await flushPendingWrites();
      lastCacheFlush = Date.now();
    }
    // Regular interval flush
    else if (Date.now() - lastCacheFlush > CACHE_FLUSH_INTERVAL) {
      console.log(`[Broadcast] Regular interval flush triggered`);
      await flushPendingWrites();
      lastCacheFlush = Date.now();
    }

    console.log(`[Broadcast] Completed in ${Date.now() - startTime}ms`);
    return result;
  } catch (error) {
    console.error(`[Broadcast] Error processing batch:`, error);
    // Ensure we flush any pending writes even if there's an error
    if (pendingWrites.size > 0) {
      console.log(`[Broadcast] Flushing pending writes after error`);
      await flushPendingWrites().catch(console.error);
    }
    throw error;
  }
}

// Function to verify transaction from the Merkle Tree
async function verifyTx(timedKey, blockId) {
  const tree = await queryTimedMerkleTree(
    new Date(timedKey).toISOString()
  );
  if (!tree) return false;

  const hashedLeaf = hash(blockId);
  const proof = tree.getProof(hashedLeaf);
  const root = tree.getRoot();
  return tree.verify(proof, hashedLeaf, root);

  // const hashedNode = blockId;
  // return tree.verify(tree.getProof(hashedNode), hashedNode, tree.getRoot());
}

// Suppose you want to find block IDs for a given timestampKey:
function findBlockByTimestampKey(timestampKey) {
  try {
    const mapping = JSON.parse(fs.readFileSync("blockMapping.json", "utf8"));
    // mapping is an object: { "blockId" : { timestampKey, hashedIds } }

    for (const [blockId, info] of Object.entries(mapping)) {
      if (info.timestampKey === timestampKey) {
        return { blockId, info };
      }
    }
  } catch (err) {
    console.error("Cannot read blockMapping.json:", err.message);
  }
  return null;
}

// Add a function to force flush all pending writes
async function forceFlushPendingWrites() {
  if (pendingWrites.size > 0) {
    console.log(`[Flush] Forcing flush of ${pendingWrites.size} pending writes`);
    await flushPendingWrites();
    lastCacheFlush = Date.now();
  }
}

// Add cleanup handler to ensure writes are flushed on process exit
process.on('beforeExit', async () => {
  await forceFlushPendingWrites();
});

// Export the new function
module.exports = {
  broadcastTx,
  forceFlushPendingWrites
};
