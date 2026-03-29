import { executionConfig } from '../config.js'
import { disconnectRedis } from '../queue/redis.js'

import { createCodeExecutionWorkerWithConcurrency } from './code-execution-worker.js'

const worker = createCodeExecutionWorkerWithConcurrency(executionConfig.workerConcurrency)

console.log(
  `[execution-service] worker started for queue code-execution (concurrency=${executionConfig.workerConcurrency})`,
)

let isShuttingDown = false

const shutdown = async (signal: string, exitCode: number): Promise<void> => {
  if (isShuttingDown) {
    return
  }

  isShuttingDown = true
  console.log(`[execution-service] worker shutting down (${signal})`)

  const forcedExitTimer = setTimeout(() => {
    process.exit(1)
  }, executionConfig.shutdownGracePeriodMs)

  forcedExitTimer.unref()

  try {
    await worker.close()
    await disconnectRedis()
    clearTimeout(forcedExitTimer)
    process.exit(exitCode)
  } catch (error) {
    console.error('[execution-service] worker shutdown failed', error)
    process.exit(1)
  }
}

process.once('SIGINT', () => {
  void shutdown('SIGINT', 0)
})

process.once('SIGTERM', () => {
  void shutdown('SIGTERM', 0)
})

process.once('uncaughtException', (error) => {
  console.error('[execution-service] uncaught exception', error)
  void shutdown('uncaughtException', 1)
})

process.once('unhandledRejection', (reason) => {
  console.error('[execution-service] unhandled rejection', reason)
  void shutdown('unhandledRejection', 1)
})
