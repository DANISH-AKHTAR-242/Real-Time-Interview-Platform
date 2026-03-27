export interface SessionConfig {
  host: string
  port: number
  databaseUrl: string
}

const getRequiredEnv = (name: string): string => {
  const value = process.env[name]

  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

export const sessionConfig: SessionConfig = {
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 3002),
  databaseUrl: getRequiredEnv('DATABASE_URL'),
}
