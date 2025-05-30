const amqp = require('amqplib');
const { broadcastTx } = require('../../utils/tendermint');
const config = require('./config');

async function consumeFromQueueInBatches() {
  const connection = await amqp.connect(config.connection.url, config.connection.options);
  const channel = await connection.createChannel();
  const queue = config.queue.name;
  const batchSize = config.consumer.prefetch;

  // Make sure the queue exists
  await channel.assertQueue(queue, config.queue.options);
  await channel.prefetch(batchSize);

  console.log(`[*] Waiting for messages in ${queue}. Batch size = ${batchSize}`);

  let currentBatch = [];

  channel.consume(
    queue,
    async (msg) => {
      if (msg !== null) {
        try {
          // Add message to current batch
          currentBatch.push(msg);
          // If we have reached the batch size, process the batch
          if (currentBatch.length >= batchSize) {
            const batch = [...currentBatch];
            currentBatch = [];
            const blockIds = batch.map((m) => JSON.parse(m.content.toString()).data.blockId);
            const timestamp = Date.now();

            console.log(`[+] Got ${batchSize} messages, broadcasting...`);

            try {
              await broadcastTx(blockIds, timestamp);
              // Acknowledge all messages in the batch
              batch.forEach((m) => channel.ack(m));
              console.log("[✓] Broadcast complete, all messages acknowledged.");
            } catch (error) {
              console.error("[x] Broadcast failed!", error);
              // If broadcast fails, reject all messages in the batch
              batch.forEach((m) => channel.nack(m, false, true));
            }
          }
        } catch (error) {
          console.error("[x] Error processing message:", error);
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

module.exports = { consumeFromQueueInBatches }; 