export interface AuthConfig {
  host: string
  port: number
  redisUrl: string
  jwtPrivateKey: string
  jwtPublicKey: string
  jwtExpiresInSeconds: number
}

const getRequiredEnv = (name: string): string => {
  const value = process.env[name]

  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
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
  port: Number(process.env.PORT ?? 3001),
  redisUrl: getRequiredEnv('REDIS_URL'),
  jwtPrivateKey: normalizePem(getRequiredEnv('JWT_PRIVATE_KEY')),
  jwtPublicKey: normalizePem(getRequiredEnv('JWT_PUBLIC_KEY')),
  jwtExpiresInSeconds: getTokenExpirySeconds(),
}
