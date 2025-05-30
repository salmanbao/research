module.exports = {
  kafka: {
    clientId: 'my-consumer-client',
    brokers: ['localhost:9093'],
    retry: {
      initialRetryTime: 1000,
      retries: 3
    },
    connectionTimeout: 10000,
  },
  consumer: {
    groupId: 'my-group',
    heartbeatInterval: 3000,
    maxWaitTimeInMs: 1000,
    sessionTimeout: 30000,
    maxBytes: 10485760,
    maxBytesPerPartition: 2097152,
    minBytes: 1024,
    maxInFlightRequests: 10,
  },
  topic: 'myTopic',
  batchSize: 100,
  numConsumers: 3,
  maxConcurrentBatches: 3,
  overloadThreshold: 2000,
  batchProcessing: {
    maxRetries: 3,
    backoffMultiplier: 1.5,
    maxBackoff: 5000,
    minBackoff: 1000,
    maxBatchSize: 100,
    minBatchSize: 10,
    adaptiveBatchSize: true,
  },
  monitoring: {
    metricsInterval: 30000,
    spikeThreshold: 3000,
    consistencyWindow: 10,
  }
}; 