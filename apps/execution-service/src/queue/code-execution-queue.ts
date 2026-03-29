import { Queue } from 'bullmq'

import { redisConnection } from './redis.js'

import type { AllowedExecutionLanguage } from '../security/policy.js'

export const CODE_EXECUTION_QUEUE_NAME = 'code-execution'

export interface CodeExecutionJobData {
  code: string
  language: AllowedExecutionLanguage
  ownerKey: string
  submittedAtMs: number
}

export interface CodeExecutionJobResult {
  stdout: string
  stderr: string
  error: string | null
}

export const codeExecutionQueue = new Queue<CodeExecutionJobData, CodeExecutionJobResult>(
  CODE_EXECUTION_QUEUE_NAME,
  {
    connection: redisConnection,
    defaultJobOptions: {
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  },
)
