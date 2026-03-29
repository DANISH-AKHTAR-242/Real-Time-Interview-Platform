import Redis from 'ioredis'

import { authConfig } from './config.js'

export interface StoredUser {
  id: string
  email: string
  passwordHash: string
  createdAt: string
}

export interface SessionData {
  sid: string
  userId: string
  email: string
}

const emailLookupKey = (email: string): string => `auth:user:email:${email.toLowerCase()}`
const userKey = (userId: string): string => `auth:user:${userId}`
const sessionKey = (sid: string): string => `auth:session:${sid}`

export const redis = new Redis(authConfig.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  enableOfflineQueue: false,
  connectTimeout: 5_000,
})

redis.on('error', (error) => {
  console.error('[auth-service] redis error', error)
})

export const connectRedis = async (): Promise<void> => {
  if (redis.status === 'ready' || redis.status === 'connecting') {
    return
  }

  await redis.connect()
}

export const disconnectRedis = async (): Promise<void> => {
  if (redis.status === 'end') {
    return
  }

  await redis.quit()
}

export const pingRedis = async (): Promise<boolean> => {
  try {
    const response = await redis.ping()
    return response === 'PONG'
  } catch {
    return false
  }
}

export const createUser = async (user: StoredUser): Promise<void> => {
  const tx = redis.multi()

  tx.set(emailLookupKey(user.email), user.id, 'NX')
  tx.set(userKey(user.id), JSON.stringify(user))

  const result = await tx.exec()
  const firstResult = result?.[0]

  if (!firstResult || firstResult[0] || firstResult[1] !== 'OK') {
    await redis.del(userKey(user.id))
    throw new Error('User already exists')
  }
}

export const findUserByEmail = async (email: string): Promise<StoredUser | null> => {
  const userId = await redis.get(emailLookupKey(email))

  if (!userId) {
    return null
  }

  const rawUser = await redis.get(userKey(userId))

  if (!rawUser) {
    return null
  }

  return JSON.parse(rawUser) as StoredUser
}

export const findUserById = async (userId: string): Promise<StoredUser | null> => {
  const rawUser = await redis.get(userKey(userId))

  if (!rawUser) {
    return null
  }

  return JSON.parse(rawUser) as StoredUser
}

export const storeSession = async (session: SessionData, ttlSeconds: number): Promise<void> => {
  await redis.set(sessionKey(session.sid), JSON.stringify(session), 'EX', ttlSeconds)
}

export const findSession = async (sid: string): Promise<SessionData | null> => {
  const rawSession = await redis.get(sessionKey(sid))

  if (!rawSession) {
    return null
  }

  return JSON.parse(rawSession) as SessionData
}
