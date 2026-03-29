export interface AuthConfig {
  host: string
  port: number
  redisUrl: string
  jwtPrivateKey: string
  jwtPublicKey: string
  jwtExpiresInSeconds: number
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
  requestTimeoutMs: number
  bodyLimitBytes: number
  trustProxy: boolean
  shutdownGracePeriodMs: number
  maxAuthAttemptsPerMinute: number
}

const getRequiredEnv = (name: string): string => {
  const value = process.env[name]

  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
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

const getBoolean = (name: string, fallback: boolean): boolean => {
  const rawValue = process.env[name]

  if (!rawValue || rawValue.trim().length === 0) {
    return fallback
  }

  if (rawValue === 'true' || rawValue === '1') {
    return true
  }

  if (rawValue === 'false' || rawValue === '0') {
    return false
  }

  throw new Error(`${name} must be one of: true, false, 1, 0`)
}

const getLogLevel = (): 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent' => {
  const rawValue = process.env.LOG_LEVEL?.trim().toLowerCase() ?? 'info'

  const allowed = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])

  if (!allowed.has(rawValue)) {
    throw new Error('LOG_LEVEL must be one of: fatal, error, warn, info, debug, trace, silent')
  }

  return rawValue as 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
}

const normalizePem = (value: string): string => {
  if (value.includes('-----BEGIN')) {
    return value
  }

  return value.replace(/\\n/g, '\n')
}

const getTokenExpirySeconds = (): number => {
  const rawValue = process.env.JWT_EXPIRES_IN ?? '900'
  const value = Number(rawValue)

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('JWT_EXPIRES_IN must be a positive integer number of seconds')
  }

  return value
}

export const authConfig: AuthConfig = {
  host: process.env.HOST ?? '0.0.0.0',
  port: getPositiveInteger('PORT', 3001),
  redisUrl: getRequiredEnv('REDIS_URL'),
  jwtPrivateKey: normalizePem(getRequiredEnv('JWT_PRIVATE_KEY')),
  jwtPublicKey: normalizePem(getRequiredEnv('JWT_PUBLIC_KEY')),
  jwtExpiresInSeconds: getTokenExpirySeconds(),
  logLevel: getLogLevel(),
  requestTimeoutMs: getPositiveInteger('REQUEST_TIMEOUT_MS', 15_000),
  bodyLimitBytes: getPositiveInteger('BODY_LIMIT_BYTES', 1_048_576),
  trustProxy: getBoolean('TRUST_PROXY', false),
  shutdownGracePeriodMs: getPositiveInteger('SHUTDOWN_GRACE_PERIOD_MS', 10_000),
  maxAuthAttemptsPerMinute: getPositiveInteger('MAX_AUTH_ATTEMPTS_PER_MINUTE', 20),
}
