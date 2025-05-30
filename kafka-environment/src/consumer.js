const { Kafka } = require('kafkajs');
const { broadcastTx } = require('../../utils/tendermint');
const config = require('./config');
const topicManager = require('./topic-manager');

// Utility function for exponential backoff
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Adaptive batch processing state
const adaptiveState = {
  currentBatchSize: config.batchSize,
  processingTimes: [],
  lastAdjustment: Date.now(),
  adjustmentInterval: 60000, // 1 minute
};

// Metrics tracking
const metrics = {
  totalProcessed: 0,
  totalErrors: 0,
  processingTimes: [],
  partitionAssignments: new Map(),
  batchProcessingTimes: new Map(),
  spikes: [],
  consistency: {
    window: [],
    average: 0,
    standardDeviation: 0,
  },
};

// Calculate standard deviation
function calculateStandardDeviation(values) {
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const squareDiffs = values.map(value => Math.pow(value - avg, 2));
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length;
  return Math.sqrt(avgSquareDiff);
}

// Adjust batch size based on performance
function adjustBatchSize(processingTime) {
  const now = Date.now();
  if (now - adaptiveState.lastAdjustment < adaptiveState.adjustmentInterval) {
    return;
  }

  adaptiveState.processingTimes.push(processingTime);
  if (adaptiveState.processingTimes.length < 5) {
    return;
  }

  const avgTime = adaptiveState.processingTimes.reduce((a, b) => a + b, 0) / adaptiveState.processingTimes.length;
  const stdDev = calculateStandardDeviation(adaptiveState.processingTimes);

  // If processing time is too high or too variable, reduce batch size
  if (avgTime > config.overloadThreshold || stdDev > config.monitoring.spikeThreshold) {
    adaptiveState.currentBatchSize = Math.max(
      config.batchProcessing.minBatchSize,
      Math.floor(adaptiveState.currentBatchSize * 0.8)
    );
  } else if (avgTime < config.overloadThreshold * 0.5 && stdDev < config.monitoring.spikeThreshold * 0.5) {
    // If processing is fast and stable, increase batch size
    adaptiveState.currentBatchSize = Math.min(
      config.batchProcessing.maxBatchSize,
      Math.floor(adaptiveState.currentBatchSize * 1.2)
    );
  }

  console.log(`[Adaptive] Batch size adjusted to ${adaptiveState.currentBatchSize} (avg: ${avgTime.toFixed(2)}ms, stdDev: ${stdDev.toFixed(2)}ms)`);
  adaptiveState.processingTimes = [];
  adaptiveState.lastAdjustment = now;
}

// Log metrics periodically
setInterval(() => {
  if (metrics.processingTimes.length > 0) {
    const avgProcessingTime = metrics.processingTimes.reduce((a, b) => a + b, 0) / metrics.processingTimes.length;
    const stdDev = calculateStandardDeviation(metrics.processingTimes);
    
    console.log(`[Metrics] Processed: ${metrics.totalProcessed}, Errors: ${metrics.totalErrors}`);
    console.log(`[Performance] Avg Time: ${avgProcessingTime.toFixed(2)}ms, StdDev: ${stdDev.toFixed(2)}ms`);
    console.log(`[Spikes] Count: ${metrics.spikes.length}, Avg Spike: ${(metrics.spikes.reduce((a, b) => a + b, 0) / metrics.spikes.length || 0).toFixed(2)}ms`);
    console.log('[Partition Assignments]', Object.fromEntries(metrics.partitionAssignments));
    
    // Log batch processing statistics
    const batchTimes = Array.from(metrics.batchProcessingTimes.values());
    if (batchTimes.length > 0) {
      const avgBatchTime = batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length;
      console.log(`[Batch Metrics] Avg Batch Time: ${avgBatchTime.toFixed(2)}ms, Total Batches: ${batchTimes.length}`);
    }
    
    // Reset metrics
    metrics.processingTimes = [];
    metrics.batchProcessingTimes.clear();
    metrics.spikes = [];
  }
}, config.monitoring.metricsInterval);

// Process a single batch with improved error handling and backoff
async function processBatch(batchMessages, instanceId, batchIndex) {
  const startTime = Date.now();
  const batchIds = batchMessages.map(m => m.value.data.blockId);
  let retryCount = 0;
  
  while (retryCount < config.batchProcessing.maxRetries) {
    try {
      await broadcastTx(batchIds, Date.now());
      const processingTime = Date.now() - startTime;
      
      // Track spikes
      if (processingTime > config.monitoring.spikeThreshold) {
        metrics.spikes.push(processingTime);
      }
      
      // Update consistency window
      metrics.consistency.window.push(processingTime);
      if (metrics.consistency.window.length > config.monitoring.consistencyWindow) {
        metrics.consistency.window.shift();
      }
      
      // Calculate consistency metrics
      if (metrics.consistency.window.length > 0) {
        metrics.consistency.average = metrics.consistency.window.reduce((a, b) => a + b, 0) / metrics.consistency.window.length;
        metrics.consistency.standardDeviation = calculateStandardDeviation(metrics.consistency.window);
      }
      
      metrics.batchProcessingTimes.set(batchIndex, processingTime);
      return { success: true, processingTime };
    } catch (error) {
      retryCount++;
      const backoffTime = Math.min(
        config.batchProcessing.maxBackoff,
        config.batchProcessing.minBackoff * Math.pow(config.batchProcessing.backoffMultiplier, retryCount)
      );
      
      console.error(`[x] Consumer ${instanceId}: Error processing batch ${batchIndex} (attempt ${retryCount}/${config.batchProcessing.maxRetries}):`, error);
      console.log(`[!] Consumer ${instanceId}: Retrying in ${backoffTime}ms`);
      
      await sleep(backoffTime);
    }
  }
  
  metrics.totalErrors++;
  throw new Error(`Failed to process batch after ${config.batchProcessing.maxRetries} attempts`);
}

async function consumeFromKafkaInBatches(instanceId = 1) {
  const metadata = await topicManager.initialize();
  const numPartitions = metadata.topics[0].partitions.length;
  
  const kafka = new Kafka({
    ...config.kafka,
    clientId: `${config.kafka.clientId}-${instanceId}`,
  });

  const consumer = kafka.consumer({
    ...config.consumer,
    groupId: config.consumer.groupId,
  });
  
  let isProcessing = false;
  let isOverloaded = false;

  try {
    console.log(`[*] Consumer ${instanceId}: Connecting to Kafka...`);
    await consumer.connect();
    console.log(`[*] Consumer ${instanceId}: Connected to Kafka successfully`);
    
    await consumer.subscribe({ 
      topic: config.topic,
      fromBeginning: true
    });
    
    console.log(`[*] Consumer ${instanceId}: Subscribed to topic ${config.topic}`);

    // Handle consumer group events
    consumer.on('consumer.group_join', ({ payload }) => {
      console.log(`[Consumer ${instanceId}] Joined consumer group:`, payload.groupId);
    });

    consumer.on('consumer.connect', () => {
      console.log(`[Consumer ${instanceId}] Connected to Kafka`);
    });

    consumer.on('consumer.disconnect', () => {
      console.log(`[Consumer ${instanceId}] Disconnected from Kafka`);
    });

    await consumer.run({
      autoCommit: false,
      eachBatch: async ({ batch, heartbeat, isRunning, isStale }) => {
        if (!isRunning() || isStale()) return;
        
        try {
          if (isOverloaded) {
            await sleep(1000);
            isOverloaded = false;
          }

          isProcessing = true;
          const messages = batch.messages;
          metrics.partitionAssignments.set(instanceId, batch.partition);
          
          console.log(`[*] Consumer ${instanceId}: Processing partition ${batch.partition}, batch size: ${messages.length}`);

          const parsedMessages = messages.map(msg => ({
            value: JSON.parse(msg.value.toString()),
            offset: msg.offset,
            partition: batch.partition
          }));

          const startTime = Date.now();
          console.log(`[+] Consumer ${instanceId}: Processing ${parsedMessages.length} messages in parallel...`);

          // Create all batch promises upfront
          const batchPromises = [];
          for (let i = 0; i < parsedMessages.length; i += adaptiveState.currentBatchSize) {
            const batchMessages = parsedMessages.slice(i, i + adaptiveState.currentBatchSize);
            batchPromises.push(processBatch(batchMessages, instanceId, i/adaptiveState.currentBatchSize));
          }

          try {
            // Process all batches in parallel with concurrency limit
            const results = await Promise.allSettled(
              batchPromises.map(async (promise, index) => {
                if (index >= config.maxConcurrentBatches) {
                  await Promise.race(batchPromises.slice(0, index));
                }
                return promise;
              })
            );

            const processingTime = Date.now() - startTime;
            
            // Adjust batch size based on performance
            if (config.batchProcessing.adaptiveBatchSize) {
              adjustBatchSize(processingTime);
            }
            
            // Update metrics
            metrics.totalProcessed += messages.length;
            metrics.processingTimes.push(processingTime);
            
            // Check for overload
            if (processingTime > config.overloadThreshold) {
              isOverloaded = true;
              console.log(`[!] Consumer ${instanceId}: System overloaded, applying backpressure`);
            }

            // Log batch processing results
            const successfulBatches = results.filter(r => r.status === 'fulfilled').length;
            console.log(`[✓] Consumer ${instanceId}: Processed ${successfulBatches}/${batchPromises.length} batches in ${processingTime}ms`);

            // Commit offsets after successful processing
            await consumer.commitOffsets([{
              topic: config.topic,
              partition: batch.partition,
              offset: (Number(batch.highWatermark) + 1).toString()
            }]);
            console.log(`[✓] Consumer ${instanceId}: Offsets committed successfully for partition ${batch.partition}`);
          } catch (error) {
            console.error(`[x] Consumer ${instanceId}: Batch processing failed!`, error);
          }
        } catch (error) {
          console.error(`[x] Consumer ${instanceId}: Error processing batch:`, error);
        } finally {
          isProcessing = false;
        }
      },
    });

    return consumer;
  } catch (error) {
    console.error(`[x] Consumer ${instanceId}: Error in consumer:`, error);
    throw error;
  }
}

module.exports = { consumeFromKafkaInBatches }; 