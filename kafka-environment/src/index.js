const { consumeFromKafkaInBatches } = require('./consumer');
const config = require('./config');

async function startConsumers() {
  console.log(`[*] Starting ${config.numConsumers} consumer instances...`);
  
  const consumers = [];
  
  for (let i = 1; i <= config.numConsumers; i++) {
    try {
      const consumer = await consumeFromKafkaInBatches(i);
      consumers.push(consumer);
      console.log(`[*] Started consumer instance ${i}`);
    } catch (error) {
      console.error(`[x] Failed to start consumer instance ${i}:`, error);
    }
  }

  // Handle graceful shutdown for all consumers
  const errorTypes = ['unhandledRejection', 'uncaughtException'];
  const signalTraps = ['SIGTERM', 'SIGINT', 'SIGUSR2'];

  errorTypes.forEach(type => {
    process.on(type, async () => {
      console.log('[*] Shutting down all consumers...');
      await Promise.all(consumers.map(consumer => consumer.disconnect()));
      process.exit(0);
    });
  });

  signalTraps.forEach(type => {
    process.once(type, async () => {
      console.log('[*] Received shutdown signal, cleaning up...');
      await Promise.all(consumers.map(consumer => consumer.disconnect()));
      process.exit(0);
    });
  });
}

// Start the consumers
startConsumers().catch(error => {
  console.error('[x] Error starting consumers:', error);
  process.exit(1);
}); 