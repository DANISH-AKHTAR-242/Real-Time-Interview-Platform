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
})

export const connectRedis = async (): Promise<void> => {
  if (redis.status === 'ready' || redis.status === 'connecting') {
    return
  }

  await redis.connect()
}

export const createUser = async (user: StoredUser): Promise<void> => {
  const tx = redis.multi()

  tx.set(emailLookupKey(user.email), user.id, 'NX')
  tx.set(userKey(user.id), JSON.stringify(user))

  const result = await tx.exec()
  const firstResult = result?.[0]

  if (!firstResult || firstResult[0] || firstResult[1] !== 'OK') {
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
