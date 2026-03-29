import { Worker, type Job } from 'bullmq'

import { runDocker } from '../docker/run.js'
import {
  CODE_EXECUTION_QUEUE_NAME,
  type CodeExecutionJobData,
  type CodeExecutionJobResult,
} from '../queue/code-execution-queue.js'
import { redisConnection } from '../queue/redis.js'
import { executionSecurityPolicy } from '../security/policy.js'
import { releaseOwnerQueueSlot } from '../security/queue-guard.js'

const getSubmittedAtMs = (job: Job<CodeExecutionJobData, CodeExecutionJobResult>): number => {
  if (typeof job.data.submittedAtMs !== 'number' || !Number.isFinite(job.data.submittedAtMs)) {
    return Date.now()
  }

  return job.data.submittedAtMs
}

const processExecutionJob = async (
  job: Job<CodeExecutionJobData, CodeExecutionJobResult>,
): Promise<CodeExecutionJobResult> => {
  const startedAtMs = Date.now()
  const ownerKey = job.data.ownerKey || 'unknown-owner'
  const queueWaitMs = Math.max(0, startedAtMs - getSubmittedAtMs(job))

  try {
    const result = await runDocker({
      code: job.data.code,
      language: job.data.language,
      timeoutMs: executionSecurityPolicy.maxExecutionTimeoutMs,
    })

    const executionMs = Date.now() - startedAtMs

    if (result.error) {
      console.warn(
        `[execution-service] execution finished with runtime error job=${job.id} owner=${ownerKey} waitMs=${queueWaitMs} executionMs=${executionMs} error=${result.error}`,
      )
    } else {
      console.info(
        `[execution-service] execution completed job=${job.id} owner=${ownerKey} waitMs=${queueWaitMs} executionMs=${executionMs}`,
      )
    }

    return result
  } catch (error) {
    const executionMs = Date.now() - startedAtMs
    const message = error instanceof Error ? error.message : 'Unknown execution error'

    console.error(
      `[execution-service] execution crashed job=${job.id} owner=${ownerKey} waitMs=${queueWaitMs} executionMs=${executionMs}`,
      error,
    )

    return {
      stdout: '',
      stderr: message,
      error: 'EXECUTION_FAILED',
    }
  } finally {
    if (typeof job.data.ownerKey === 'string' && job.data.ownerKey.length > 0) {
      try {
        await releaseOwnerQueueSlot(job.data.ownerKey)
      } catch (releaseError) {
        console.error(
          `[execution-service] failed to release queue slot for owner=${job.data.ownerKey}`,
          releaseError,
        )
      }
    }
  }
}

export const createCodeExecutionWorker = (): Worker<
  CodeExecutionJobData,
  CodeExecutionJobResult
> => {
  return createCodeExecutionWorkerWithConcurrency(2)
}

export const createCodeExecutionWorkerWithConcurrency = (
  concurrency: number,
): Worker<CodeExecutionJobData, CodeExecutionJobResult> => {
  const worker = new Worker<CodeExecutionJobData, CodeExecutionJobResult>(
    CODE_EXECUTION_QUEUE_NAME,
    processExecutionJob,
    {
      connection: redisConnection,
      concurrency,
    },
  )

  worker.on('completed', (job) => {
    console.log(`[execution-service] completed job ${job.id}`)
  })

  worker.on('failed', (job, error) => {
    console.error(`[execution-service] failed job ${job?.id ?? 'unknown'}`, error)
  })

  worker.on('error', (error) => {
    console.error('[execution-service] worker error', error)
  })

  return worker
}
