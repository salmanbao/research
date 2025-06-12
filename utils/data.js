const fs = require("fs");
const { Kafka, Partitioners } = require("kafkajs");
const amqp = require('amqplib');
const path = require('path');

// Configuration
const config = {
  messageBroker: 'rabbitmq', // 'kafka' or 'rabbitmq'
  kafka: {
    broker: "localhost:9093",
    topic: "myTopic",
    clientId: "my-producer-client"
  },
  rabbitmq: {
    url: "amqp://localhost",
    queue: "myQueue",
    options: {
      durable: true
    }
  }
};

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function call(data) {
  return await (
    await fetch("http://localhost:3000/store", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    })
  ).json();
}

/************************************
 * Data Generation
 ************************************/

function generateData(tag) {
  // Assign priority randomly for demonstration
  const priorities = ["high", "medium", "low"];
  const priority = priorities[randInt(0, 2)];
  switch (tag) {
    case "Electricity":
      return {
        deviceId: "sensor_001",
        power: randInt(300, 500),
        voltage: randInt(110, 260),
        current: rand(5, 10).toFixed(2),
        battery: randInt(10, 100),
        status: randInt(0, 1) === 0 ? "inactive" : "active",
        location: {
          latitude: rand(52, 177).toFixed(4),
          longitude: rand(-133, 133).toFixed(4),
        },
        firmwareVersion: "2.13.6",
        priority,
      };
    case "Gas":
      return {
        deviceId: "sensor_002",
        temperature: rand(22, 100).toFixed(2),
        humidity: rand(10, 80).toFixed(2),
        battery: randInt(10, 100),
        status: randInt(0, 1) === 0 ? "inactive" : "active",
        location: {
          latitude: rand(52, 177).toFixed(4),
          longitude: rand(-133, 133).toFixed(4),
        },
        firmwareVersion: "4.4.0",
        priority,
      };
    case "Water":
      return {
        deviceId: "sensor_003",
        gasFlowRate: {
          value: rand(15, 50).toFixed(2),
          unit: "m³/h",
        },
        totalGasUsage: {
          value: rand(150, 300).toFixed(2),
          unit: "m³",
        },
        battery: randInt(10, 100),
        status: randInt(0, 1) === 0 ? "inactive" : "active",
        location: {
          latitude: rand(52, 177).toFixed(4),
          longitude: rand(-133, 133).toFixed(4),
        },
        firmwareVersion: "2.13.6",
        priority,
      };
    default:
      throw new Error(`Unknown tag: ${tag}`);
  }
}

/************************************
 * Message Broker Implementation
 ************************************/

class MessageBroker {
  constructor() {
    this.kafkaProducer = null;
    this.rabbitmqChannel = null;
    this.rabbitmqConnection = null;
  }

  async connect() {
    if (config.messageBroker === 'kafka') {
      await this.connectKafka();
    } else {
      await this.connectRabbitMQ();
    }
  }

  async disconnect() {
    if (config.messageBroker === 'kafka') {
      await this.disconnectKafka();
    } else {
      await this.disconnectRabbitMQ();
    }
  }

  async sendMessage(message) {
    if (config.messageBroker === 'kafka') {
      await this.sendToKafka(message);
    } else {
      await this.sendToRabbitMQ(message);
    }
  }

  // Kafka Methods
  async connectKafka() {
    const kafka = new Kafka({
      clientId: config.kafka.clientId,
      brokers: [config.kafka.broker],
    });

    this.kafkaProducer = kafka.producer({
      createPartitioner: Partitioners.DefaultPartitioner
    });
    await this.kafkaProducer.connect();
    console.log("Connected to Kafka successfully!");
  }

  async disconnectKafka() {
    if (this.kafkaProducer) {
      await this.kafkaProducer.disconnect();
      console.log("Kafka producer disconnected.");
    }
  }

  async sendToKafka(message) {
    if (!this.kafkaProducer) {
      throw new Error("Kafka producer not initialized. Call connect first.");
    }

    await this.kafkaProducer.send({
      topic: config.kafka.topic,
      messages: [{ value: JSON.stringify(message) }],
    });

    console.log(`[x] Sent to Kafka: ${JSON.stringify(message)}`);
  }

  // RabbitMQ Methods
  async connectRabbitMQ() {
    this.rabbitmqConnection = await amqp.connect(config.rabbitmq.url);
    this.rabbitmqChannel = await this.rabbitmqConnection.createChannel();
    await this.rabbitmqChannel.assertQueue(config.rabbitmq.queue, config.rabbitmq.options);
    console.log("Connected to RabbitMQ successfully!");
  }

  async disconnectRabbitMQ() {
    if (this.rabbitmqChannel) {
      await this.rabbitmqChannel.close();
    }
    if (this.rabbitmqConnection) {
      await this.rabbitmqConnection.close();
    }
    console.log("RabbitMQ connection closed.");
  }

  async sendToRabbitMQ(message) {
    if (!this.rabbitmqChannel) {
      throw new Error("RabbitMQ channel not initialized. Call connect first.");
    }

    this.rabbitmqChannel.sendToQueue(
      config.rabbitmq.queue,
      Buffer.from(JSON.stringify(message))
    );

    console.log(`[x] Sent to RabbitMQ: ${JSON.stringify(message)}`);
  }

  async sendMessageToQueue(message, queueName) {
    if (config.messageBroker === 'rabbitmq') {
      await this.rabbitmqChannel.assertQueue(queueName, { durable: true });
      await this.rabbitmqChannel.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), { persistent: true });
    }
    // ... (Kafka logic if needed)
  }
}

/************************************
 * Request + Save
 ************************************/

async function requestAndSave(tag, dataPayload) {
  // Add timestamp to the payload here if needed (if not already present)
  // For now, just send to IOTA and return the response with the original payload
  const payloadWithTimestamp = {
    ...dataPayload,
  };
  const response = await call({ tag, data: payloadWithTimestamp });
  // Return both the response and the payload for batching
  return { ...response, payload: payloadWithTimestamp };
}

class BatchManager {
  constructor({ messageBroker, batchFile = 'batches.json', batchSize = 10 }) {
    this.messageBroker = messageBroker;
    this.batchFile = batchFile;
    this.batchSize = batchSize;
    this.pendingBatch = [];
    this.filePath = path.resolve(__dirname, '..', this.batchFile);
    // Ensure the file exists (optional, for legacy)
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify([]));
    }
  }

  async handleBatch(batch) {
    if (!batch || batch.length === 0) return;
    // Prepare batch data (array of iotaResponse objects)
    const batchData = batch.map(item => item.iotaResponse);
    try {
      // Two-queue approach: send batch to both queues
      await this.messageBroker.sendMessageToQueue(batchData, 'myQueue-tendermint');
      await this.messageBroker.sendMessageToQueue(batchData, 'myQueue-file');
      // File writing is now handled by the independent consumer (consumeAndWriteBatchesToFile)
    } catch (err) {
      // Discard batch on error
      console.error('[BatchManager] Failed to queue batch, discarding:', err);
    }
  }

  // appendBatchToFile removed: file writing is now handled by the consumer
}

/**
 * Parallel-Aware Priority Scheduler
 */
class PriorityScheduler {
  constructor({ batchSize = 10, parallelism = 3, agingMs = 5000, batchManager = null } = {}) {
    this.queues = {
      high: [],
      medium: [],
      low: [],
    };
    this.batchSize = batchSize;
    this.parallelism = parallelism;
    this.agingMs = agingMs;
    this.activeBatches = 0;
    this.totalProcessed = 0;
    this.totalDropped = 0;
    this.resolve = null;
    this.donePromise = new Promise((resolve) => (this.resolve = resolve));
    this.running = false;
    this.timer = null;
    this.batchManager = batchManager;
    // Load-aware batching parameters
    this.minBatchSize = 100;
    this.maxBatchSize = 500;
    this.loadCheckIntervalMs = 1000;
    this.lastLoadCheck = Date.now();
  }

  /**
   * Adjust batch size based on total queue length (load-aware batching)
   */
  adjustBatchSize() {
    const totalQueueLength = this.queues.high.length + this.queues.medium.length + this.queues.low.length;
    if (totalQueueLength > this.batchSize * 3) {
      // High load: increase batch size
      this.batchSize = Math.min(this.batchSize + 5, this.maxBatchSize);
    } else if (totalQueueLength < this.batchSize) {
      // Low load: decrease batch size
      this.batchSize = Math.max(this.batchSize - 5, this.minBatchSize);
    }
    // Optionally, log for monitoring
    // console.log(`Adjusted batch size: ${this.batchSize} (Queue: ${totalQueueLength})`);
  }

  /**
   * Schedule a new request.
   * @param {object} request
   */
  schedule(request) {
    const { priority } = request.data;
    const entry = { ...request, enqueuedAt: Date.now() };
    this.queues[priority].push(entry);
    if (!this.running) {
      this.running = true;
      this.run();
    }
  }

  /**
   * Promote aged requests to higher priority.
   */
  promoteAgedRequests() {
    const now = Date.now();
    // Promote from low to medium
    this.queues.low = this.queues.low.filter((item) => {
      if (now - item.enqueuedAt > this.agingMs) {
        item.data.priority = "medium";
        this.queues.medium.push(item);
        return false;
      }
      return true;
    });
    // Promote from medium to high
    this.queues.medium = this.queues.medium.filter((item) => {
      if (now - item.enqueuedAt > this.agingMs * 2) {
        item.data.priority = "high";
        this.queues.high.push(item);
        return false;
      }
      return true;
    });
  }

  /**
   * Run the scheduler loop.
   */
  async run() {
    this.timer = setInterval(() => this.promoteAgedRequests(), 1000);
    while (
      this.queues.high.length ||
      this.queues.medium.length ||
      this.queues.low.length ||
      this.activeBatches > 0
    ) {
      // Periodically adjust batch size based on queue length
      if (Date.now() - this.lastLoadCheck > this.loadCheckIntervalMs) {
        this.adjustBatchSize();
        this.lastLoadCheck = Date.now();
      }
      while (this.activeBatches < this.parallelism) {
        const batch = this.getNextBatch();
        if (!batch.length) break;
        this.activeBatches++;
        this.processBatch(batch)
          .then(() => {
            this.activeBatches--;
          })
          .catch(() => {
            this.activeBatches--;
            this.totalDropped += batch.length;
          });
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    clearInterval(this.timer);
    this.resolve();
  }

  /**
   * Get the next batch based on priority.
   */
  getNextBatch() {
    for (const level of ["high", "medium", "low"]) {
      if (this.queues[level].length) {
        // Dynamic batch size: up to batchSize or all available
        const size = Math.min(this.batchSize, this.queues[level].length);
        return this.queues[level].splice(0, size);
      }
    }
    return [];
  }

  /**
   * Process a batch: send to IOTA and handle results.
   */
  async processBatch(batch) {
    // Process all requests in the batch in parallel
    const results = await Promise.all(
      batch.map(async (item) => {
        try {
          // Only send to IOTA and return the response
          const iotaResponse = await requestAndSave(item.tag, item.data);
          this.totalProcessed++;
          return { iotaResponse };
        } catch (err) {
          // Drop failed requests
          this.totalDropped++;
          return null;
        }
      })
    );
    // Filter out failed responses
    const successfulBatch = results.filter(r => r !== null);
    // Pass successfulBatch to BatchManager for queueing and file writing
    if (this.batchManager) {
      await this.batchManager.handleBatch(successfulBatch);
    }
  }

  /**
   * Wait for all scheduled requests to finish.
   */
  async waitUntilDone() {
    await this.donePromise;
  }
}

// Refactored sendSimultaneousRequests
async function sendSimultaneousRequests() {
  const messageBroker = new MessageBroker();
  await messageBroker.connect();
  const tags = ["Electricity", "Gas", "Water"];
  const totalRequests = 300 * tags.length;
  const batchSize = 100;
  const batchManager = new BatchManager({ messageBroker, batchFile: 'batches.json', batchSize });
  const scheduler = new PriorityScheduler({ batchSize, parallelism: 3, agingMs: 5000, batchManager });
  for (let i = 0; i < 300; i++) {
    for (const tag of tags) {
      const data = generateData(tag);
      scheduler.schedule({ tag, data, messageBroker });
    }
  }
  await scheduler.waitUntilDone();
  console.log("\n=== Scheduler Statistics ===");
  console.log(`Total Requests: ${totalRequests}`);
  console.log(`Processed: ${scheduler.totalProcessed}`);
  console.log(`Dropped: ${scheduler.totalDropped}`);
  await messageBroker.disconnect();
}

// Export configuration for external use
module.exports = {
  config,
  sendSimultaneousRequests
};

// Invoke the simultaneous requests if this file is run directly
if (require.main === module) {
  sendSimultaneousRequests().catch(console.error);
}
