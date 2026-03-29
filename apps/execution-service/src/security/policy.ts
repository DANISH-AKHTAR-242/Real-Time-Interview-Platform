export const executionSecurityPolicy = {
  allowedLanguages: ['javascript', 'python'] as const,
  maxCodeBytes: 16 * 1024,
  maxExecutionTimeoutMs: 5_000,
  dockerMemoryLimitMb: 256,
  dockerCpuLimit: 0.5,
  dockerMaxPids: 32,
  dockerTmpfsSizeMb: 16,
  dockerMaxFileSizeBytes: 1_048_576,
  dockerMaxOpenFiles: 64,
  maxCapturedOutputBytes: 64 * 1024,
  rateLimitWindowMs: 60_000,
  userRequestsPerWindow: 20,
  anonymousRequestsPerWindow: 8,
  ipRequestsPerWindow: 40,
  maxGlobalPendingJobs: 200,
  maxPendingJobsPerOwner: 5,
  ownerQueueSlotTtlSeconds: 900,
} as const

export type AllowedExecutionLanguage = (typeof executionSecurityPolicy.allowedLanguages)[number]
