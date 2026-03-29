export interface ExecutionConfig {
  host: string
  port: number
  redisUrl: string
  workerConcurrency: number
  shutdownGracePeriodMs: number
}

const getPositiveInteger = (name: string, fallback: number): number => {
  const rawValue = process.env[name]

  if (!rawValue || rawValue.trim().length === 0) {
    return fallback
  }

  const parsed = Number(rawValue)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }

  return parsed
}

export const executionConfig: ExecutionConfig = {
  host: process.env.HOST ?? '0.0.0.0',
  port: getPositiveInteger('PORT', 3004),
  redisUrl: process.env.REDIS_URL?.trim() || 'redis://localhost:6379',
  workerConcurrency: getPositiveInteger('WORKER_CONCURRENCY', 2),
  shutdownGracePeriodMs: getPositiveInteger('SHUTDOWN_GRACE_PERIOD_MS', 10_000),
}
