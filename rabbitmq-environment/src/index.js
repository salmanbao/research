const { consumeFromQueueInBatches, consumeAndWriteBatchesToFile } = require('./consumer');

async function startConsumer() {
  try {
    console.log('[*] Starting RabbitMQ consumer...');
    const { connection, channel } = await consumeFromQueueInBatches();
    await consumeAndWriteBatchesToFile();
    console.log('[*] Consumer started successfully');
  } catch (error) {
    console.error('[x] Error starting consumer:', error);
    process.exit(1);
  }
}

// Start the consumer
startConsumer(); 