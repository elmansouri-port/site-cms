import mongoose from 'mongoose';
import { config } from '../config.js';
import { logger } from './log.js';

mongoose.set('strictQuery', true);

export async function connectMongo(uri = config.mongoUri) {
  mongoose.connection.on('connected', () => logger.info({ uri: redact(uri) }, 'mongo connected'));
  mongoose.connection.on('error', (err) => logger.error({ err }, 'mongo error'));
  mongoose.connection.on('disconnected', () => logger.warn('mongo disconnected'));

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 20,
    autoIndex: config.env !== 'production',
  });
  return mongoose.connection;
}

export async function disconnectMongo() {
  await mongoose.disconnect();
}

function redact(uri) {
  return String(uri).replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
}
