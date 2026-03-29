export interface CollabConfig {
  host: string
  port: number
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
  maxPayloadBytes: number
  shutdownGracePeriodMs: number
  jwtPublicKey: string
  sessionServiceUrl?: string
  allowMockSessionAccess: boolean
  sessionServiceTimeoutMs: number
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

const normalizePem = (value: string): string => {
  if (value.includes('-----BEGIN')) {
    return value
  }

  return value.replace(/\\n/g, '\n')
}

const getLogLevel = (): 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent' => {
  const rawValue = process.env.LOG_LEVEL?.trim().toLowerCase() ?? 'info'

  const allowed = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])

  if (!allowed.has(rawValue)) {
    throw new Error('LOG_LEVEL must be one of: fatal, error, warn, info, debug, trace, silent')
  }

  return rawValue as 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
}

const getOptionalEnv = (name: string): string | undefined => {
  const value = process.env[name]?.trim()

  if (!value) {
    return undefined
  }

  return value.replace(/\/$/, '')
}

export const collabConfig: CollabConfig = {
  host: process.env.HOST ?? '0.0.0.0',
  port: getPositiveInteger('PORT', 3002),
  logLevel: getLogLevel(),
  maxPayloadBytes: getPositiveInteger('MAX_PAYLOAD_BYTES', 1_048_576),
  shutdownGracePeriodMs: getPositiveInteger('SHUTDOWN_GRACE_PERIOD_MS', 10_000),
  jwtPublicKey: normalizePem(getRequiredEnv('JWT_PUBLIC_KEY')),
  sessionServiceUrl: getOptionalEnv('SESSION_SERVICE_URL'),
  allowMockSessionAccess: getBoolean('ALLOW_MOCK_SESSION_ACCESS', false),
  sessionServiceTimeoutMs: getPositiveInteger('SESSION_SERVICE_TIMEOUT_MS', 4_000),
}
