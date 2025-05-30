module.exports = {
  connection: {
    url: 'amqp://localhost:5672',
    options: {
      heartbeat: 60,
      timeout: 30000,
    }
  },
  queue: {
    name: 'myQueue',
    options: {
      durable: true,
    }
  },
  consumer: {
    prefetch: 100, // Batch size
    noAck: false,
  }
}; 