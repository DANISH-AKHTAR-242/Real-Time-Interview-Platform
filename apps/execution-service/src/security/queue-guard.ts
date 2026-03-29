import { codeExecutionQueue } from '../queue/code-execution-queue.js'
import { redisConnection } from '../queue/redis.js'

import { executionSecurityPolicy } from './policy.js'

const buildOwnerQueueSlotKey = (ownerKey: string): string => {
  return `execution-service:owner-queue-slots:${ownerKey}`
}

export const getGlobalPendingJobCount = async (): Promise<number> => {
  const counts = await codeExecutionQueue.getJobCounts(
    'waiting',
    'active',
    'delayed',
    'prioritized',
  )

  return (
    (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0) + (counts.prioritized ?? 0)
  )
}

export const reserveOwnerQueueSlot = async (ownerKey: string): Promise<boolean> => {
  const key = buildOwnerQueueSlotKey(ownerKey)
  const slotCount = await redisConnection.incr(key)

  await redisConnection.expire(key, executionSecurityPolicy.ownerQueueSlotTtlSeconds)

  if (slotCount <= executionSecurityPolicy.maxPendingJobsPerOwner) {
    return true
  }

  await redisConnection.decr(key)
  return false
}

export const releaseOwnerQueueSlot = async (ownerKey: string): Promise<void> => {
  const key = buildOwnerQueueSlotKey(ownerKey)
  const remaining = await redisConnection.decr(key)

  if (remaining <= 0) {
    await redisConnection.del(key)
  }
}
