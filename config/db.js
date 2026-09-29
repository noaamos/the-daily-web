const mongoose = require('mongoose');
const logger = require('./logger');

async function connectDB() {
  await mongoose.connect(process.env.MONGO_URI);
  logger.info(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
}

module.exports = connectDB;
