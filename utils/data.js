const fs = require("fs");
const { Kafka, Partitioners } = require("kafkajs");
const amqp = require('amqplib');

// Configuration
const config = {
  messageBroker: 'kafka', // 'kafka' or 'rabbitmq'
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
}

/************************************
 * Request + Save
 ************************************/

async function requestAndSave(tag, messageBroker) {
  try {
    // 1) Generate data
    const dataPayload = generateData(tag);

    // 2) Send request
    const response = await call({ tag, data: dataPayload });

    // 4) Publish the response to message broker
    await messageBroker.sendMessage({
      tag,
      data: response,
    });

    // 3) Save response to file
    let existingData = [];
    try {
      const fileContent = fs.readFileSync(`${tag}.json`, "utf-8");
      existingData = JSON.parse(fileContent);
      if (!Array.isArray(existingData)) {
        existingData = [];
      }
    } catch (err) {
      existingData = [];
    }

    existingData.push(response);
    fs.writeFileSync(`${tag}.json`, JSON.stringify(existingData, null, 2));


  } catch (error) {
    console.error(`Error in requestAndSave for ${tag}`, error);
    throw error;
  }
}

/************************************
 * Send 100 Requests Simultaneously
 ************************************/

async function sendSimultaneousRequests() {
  const messageBroker = new MessageBroker();
  await messageBroker.connect();

  const tags = ["Electricity", "Gas", "Water"];
  const promises = [];

  for (let i = 0; i < 1000; i++) {
    for (const tag of tags) {
      promises.push(requestAndSave(tag, messageBroker));
    }
  }

  // Wait until all requests complete
  console.log("Total promises created:", promises.length);
  const results = await Promise.allSettled(promises);
  
  // Calculate and print detailed statistics
  const resolvedPromises = results.filter(p => p.status === "fulfilled");
  const rejectedPromises = results.filter(p => p.status === "rejected");
  
  console.log("\n=== Promise Resolution Statistics ===");
  console.log(`Total Promises: ${results.length}`);
  console.log(`Resolved Promises: ${resolvedPromises.length} (${((resolvedPromises.length/results.length)*100).toFixed(2)}%)`);
  console.log(`Rejected Promises: ${rejectedPromises.length} (${((rejectedPromises.length/results.length)*100).toFixed(2)}%)`);
  

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
