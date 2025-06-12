const amqp = require('amqplib');
const { broadcastTx } = require('../../utils/tendermint');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// Tendermint processing consumer (queue: myQueue-tendermint)
async function consumeFromQueueInBatches() {
  const connection = await amqp.connect(config.connection.url, config.connection.options);
  const channel = await connection.createChannel();
  const queue = 'myQueue-tendermint';

  // Make sure the queue exists
  await channel.assertQueue(queue, config.queue.options);
  await channel.prefetch(5); // Increased parallelism

  console.log(`[*] Waiting for batch messages in ${queue}. Each message is a batch.`);

  channel.consume(
    queue,
    async (msg) => {
      if (msg !== null) {
        try {
          // Parse the batch (array of IOTA responses)
          const batch = JSON.parse(msg.content.toString());
          if (!Array.isArray(batch)) {
            throw new Error('Received message is not a batch array');
          }
          const blockIds = batch.map(item => item.blockId).filter(Boolean);
          const timestamp = Date.now();

          console.log(`[+] Received batch of size ${batch.length}, broadcasting...`);

          try {
            await broadcastTx(blockIds, timestamp);
            channel.ack(msg);
            console.log(`[✓] Broadcast complete for batch of size ${batch.length}.`);
          } catch (error) {
            console.error('[x] Broadcast failed for batch!', error);
            channel.nack(msg, false, true);
          }
        } catch (error) {
          console.error('[x] Error processing batch message:', error);
          channel.nack(msg, false, true);
        }
      }
    },
    { noAck: config.consumer.noAck }
  );

  // Handle graceful shutdown
  const errorTypes = ['unhandledRejection', 'uncaughtException'];
  const signalTraps = ['SIGTERM', 'SIGINT', 'SIGUSR2'];

  errorTypes.forEach(type => {
    process.on(type, async () => {
      console.log('[*] Shutting down consumer...');
      await channel.close();
      await connection.close();
      process.exit(0);
    });
  });

  signalTraps.forEach(type => {
    process.once(type, async () => {
      console.log('[*] Received shutdown signal, cleaning up...');
      await channel.close();
      await connection.close();
      process.exit(0);
    });
  });

  return { connection, channel };
}

// Independent file-writing consumer (queue: myQueue-file)
async function consumeAndWriteBatchesToFile() {
  const connection = await amqp.connect(config.connection.url, config.connection.options);
  const channel = await connection.createChannel();
  const queue = 'myQueue-file';
  const filePath = path.resolve(__dirname, '../../batches.json');

  // Ensure the file exists
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([]));
  }

  await channel.assertQueue(queue, config.queue.options);
  await channel.prefetch(5); // Parallelism for file writing

  console.log(`[*] File-writing consumer waiting for batch messages in ${queue}. Each message is a batch.`);

  channel.consume(
    queue,
    async (msg) => {
      if (msg !== null) {
        try {
          const batch = JSON.parse(msg.content.toString());
          if (!Array.isArray(batch)) {
            throw new Error('Received message is not a batch array');
          }
          // Read, append, and write asynchronously
          try {
            const fileContent = await fs.promises.readFile(filePath, 'utf-8');
            let batches = [];
            try {
              batches = JSON.parse(fileContent);
              if (!Array.isArray(batches)) batches = [];
            } catch (err) {
              batches = [];
            }
            batches = batches.concat(batch);
            fs.writeFileSync(filePath, JSON.stringify(batches, null, 2));
            channel.ack(msg);
            console.log(`[✓] Batch of size ${batch.length} written to file.`);
          } catch (err) {
            console.error('[x] Failed to write batch to file:', err);
            channel.nack(msg, false, true);
          }
        } catch (error) {
          console.error('[x] Error processing batch message for file writing:', error);
          channel.nack(msg, false, true);
        }
      }
    },
    { noAck: config.consumer.noAck }
  );

  // Handle graceful shutdown
  const errorTypes = ['unhandledRejection', 'uncaughtException'];
  const signalTraps = ['SIGTERM', 'SIGINT', 'SIGUSR2'];

  errorTypes.forEach(type => {
    process.on(type, async () => {
      console.log('[*] Shutting down file-writing consumer...');
      await channel.close();
      await connection.close();
      process.exit(0);
    });
  });

  signalTraps.forEach(type => {
    process.once(type, async () => {
      console.log('[*] Received shutdown signal, cleaning up file-writing consumer...');
      await channel.close();
      await connection.close();
      process.exit(0);
    });
  });

  return { connection, channel };
}

module.exports = { consumeFromQueueInBatches, consumeAndWriteBatchesToFile }; 