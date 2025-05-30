const { Kafka } = require('kafkajs');
const config = require('./config');

class TopicManager {
  constructor() {
    this.kafka = new Kafka({
      ...config.kafka,
      clientId: `${config.kafka.clientId}-admin`,
    });
    this.admin = this.kafka.admin();
  }

  async initialize() {
    try {
      await this.admin.connect();
      console.log('[TopicManager] Connected to Kafka');

      // Create topic with partitions if it doesn't exist
      await this.createTopicIfNotExists();
      
      // Get topic metadata
      const metadata = await this.admin.fetchTopicMetadata({
        topics: [config.topic]
      });

      console.log(`[TopicManager] Topic ${config.topic} has ${metadata.topics[0].partitions.length} partitions`);
      return metadata;
    } catch (error) {
      console.error('[TopicManager] Error initializing:', error);
      throw error;
    } finally {
      await this.admin.disconnect();
    }
  }

  async createTopicIfNotExists() {
    try {
      const existingTopics = await this.admin.listTopics();
      
      if (!existingTopics.includes(config.topic)) {
        await this.admin.createTopics({
          topics: [{
            topic: config.topic,
            numPartitions: 3, // Number of partitions
            replicationFactor: 1, // For single broker setup
            configEntries: [
              {
                name: 'retention.ms',
                value: '604800000' // 7 days
              },
              {
                name: 'cleanup.policy',
                value: 'delete'
              }
            ]
          }]
        });
        console.log(`[TopicManager] Created topic ${config.topic} with 3 partitions`);
      }
    } catch (error) {
      console.error('[TopicManager] Error creating topic:', error);
      throw error;
    }
  }

  // Get partition for a message based on blockId
  getPartition(blockId, numPartitions) {
    // Simple hash-based partitioning
    const hash = this.hashString(blockId);
    return Math.abs(hash % numPartitions);
  }

  // Simple string hashing function
  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }
}

module.exports = new TopicManager(); 