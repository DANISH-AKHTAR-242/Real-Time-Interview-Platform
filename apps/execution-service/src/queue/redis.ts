import IORedis from 'ioredis'

import { executionConfig } from '../config.js'

export const redisConnection = new IORedis(executionConfig.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
})

redisConnection.on('error', (error) => {
  console.error('[execution-service] redis error', error)
})

export const pingRedis = async (): Promise<boolean> => {
  try {
    const response = await redisConnection.ping()
    return response === 'PONG'
  } catch {
    return false
  }
}

export const disconnectRedis = async (): Promise<void> => {
  if (redisConnection.status === 'end') {
    return
  }

  await redisConnection.quit()
}
