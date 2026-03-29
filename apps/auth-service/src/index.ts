import { randomUUID } from 'node:crypto'

import bcrypt from 'bcrypt'
import Fastify from 'fastify'

import { authPreHandler } from './auth-middleware.js'
import { authConfig } from './config.js'
import { signAccessToken } from './jwt.js'
import {
  connectRedis,
  createUser,
  disconnectRedis,
  findUserByEmail,
  findUserById,
  pingRedis,
  storeSession,
  type StoredUser,
} from './redis.js'

interface AuthBody {
  email: string
  password: string
}

interface AuthRateLimitRecord {
  count: number
  windowExpiresAt: number
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const authRateLimitStore = new Map<string, AuthRateLimitRecord>()
const AUTH_WINDOW_MS = 60_000

const getClientIp = (
  rawForwardedFor: string | string[] | undefined,
  fallbackIp: string,
): string => {
  const forwardedFor = Array.isArray(rawForwardedFor) ? rawForwardedFor[0] : rawForwardedFor

  if (!forwardedFor || forwardedFor.trim().length === 0) {
    return fallbackIp
  }

  return forwardedFor.split(',')[0]?.trim() || fallbackIp
}

const pruneRateLimitStore = (now: number): void => {
  if (authRateLimitStore.size <= 5_000) {
    return
  }

  authRateLimitStore.forEach((record, key) => {
    if (record.windowExpiresAt <= now) {
      authRateLimitStore.delete(key)
    }
  })
}

const isAuthAttemptAllowed = (key: string): boolean => {
  const now = Date.now()
  pruneRateLimitStore(now)

  const existing = authRateLimitStore.get(key)

  if (!existing || existing.windowExpiresAt <= now) {
    authRateLimitStore.set(key, {
      count: 1,
      windowExpiresAt: now + AUTH_WINDOW_MS,
    })

    return true
  }

  if (existing.count >= authConfig.maxAuthAttemptsPerMinute) {
    return false
  }

  existing.count += 1
  return true
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase()

const assertAuthBody = (body: unknown): AuthBody => {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid request body')
  }

  const { email, password } = body as Partial<AuthBody>

  if (typeof email !== 'string' || typeof password !== 'string') {
    throw new Error('Invalid request body')
  }

  const normalizedEmail = normalizeEmail(email)

  if (!emailRegex.test(normalizedEmail)) {
    throw new Error('Email is invalid')
  }

  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters')
  }

  return {
    email: normalizedEmail,
    password,
  }
}

const server = Fastify({
  logger: {
    level: authConfig.logLevel,
  },
  trustProxy: authConfig.trustProxy,
  bodyLimit: authConfig.bodyLimitBytes,
  requestTimeout: authConfig.requestTimeoutMs,
})

server.addHook('onSend', async (_request, reply, payload) => {
  reply.header('x-content-type-options', 'nosniff')
  reply.header('x-frame-options', 'DENY')
  reply.header('referrer-policy', 'no-referrer')
  return payload
})

server.setErrorHandler((error, request, reply) => {
  request.log.error(error)

  if (!reply.sent) {
    reply.code(500).send({ message: 'Internal server error' })
  }
})

server.get('/health', async () => {
  return {
    service: 'auth-service',
    status: 'ok',
  }
})

server.get('/ready', async (request, reply) => {
  const redisReady = await pingRedis()

  if (!redisReady) {
    request.log.warn('readiness check failed: redis unavailable')
    return reply.code(503).send({
      service: 'auth-service',
      status: 'degraded',
      dependency: 'redis',
    })
  }

  return reply.code(200).send({
    service: 'auth-service',
    status: 'ready',
  })
})

server.post('/register', async (request, reply) => {
  let body: AuthBody

  try {
    body = assertAuthBody(request.body)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bad request'
    return reply.code(400).send({ message })
  }

  const clientIp = getClientIp(request.headers['x-forwarded-for'], request.ip)
  const rateLimitKey = `register:${clientIp}:${body.email}`

  if (!isAuthAttemptAllowed(rateLimitKey)) {
    return reply.code(429).send({ message: 'Too many attempts. Please retry later.' })
  }

  try {
    const existingUser = await findUserByEmail(body.email)

    if (existingUser) {
      return reply.code(409).send({ message: 'Email already registered' })
    }

    const user: StoredUser = {
      id: randomUUID(),
      email: body.email,
      passwordHash: await bcrypt.hash(body.password, 12),
      createdAt: new Date().toISOString(),
    }

    await createUser(user)

    const sid = randomUUID()
    const tokenBundle = signAccessToken({
      userId: user.id,
      sid,
      email: user.email,
    })

    await storeSession(
      {
        sid,
        userId: user.id,
        email: user.email,
      },
      tokenBundle.ttlSeconds,
    )

    return reply.code(201).send({
      token: tokenBundle.token,
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
      },
    })
  } catch (error) {
    request.log.error(error)
    return reply.code(503).send({ message: 'Auth storage unavailable' })
  }
})

server.post('/login', async (request, reply) => {
  let body: AuthBody

  try {
    body = assertAuthBody(request.body)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bad request'
    return reply.code(400).send({ message })
  }

  const clientIp = getClientIp(request.headers['x-forwarded-for'], request.ip)
  const rateLimitKey = `login:${clientIp}:${body.email}`

  if (!isAuthAttemptAllowed(rateLimitKey)) {
    return reply.code(429).send({ message: 'Too many attempts. Please retry later.' })
  }

  try {
    const user = await findUserByEmail(body.email)

    if (!user) {
      return reply.code(401).send({ message: 'Invalid credentials' })
    }

    const passwordMatches = await bcrypt.compare(body.password, user.passwordHash)

    if (!passwordMatches) {
      return reply.code(401).send({ message: 'Invalid credentials' })
    }

    const sid = randomUUID()
    const tokenBundle = signAccessToken({
      userId: user.id,
      sid,
      email: user.email,
    })

    await storeSession(
      {
        sid,
        userId: user.id,
        email: user.email,
      },
      tokenBundle.ttlSeconds,
    )

    return reply.code(200).send({
      token: tokenBundle.token,
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
      },
    })
  } catch (error) {
    request.log.error(error)
    return reply.code(503).send({ message: 'Auth storage unavailable' })
  }
})

server.get('/me', { preHandler: authPreHandler }, async (request, reply) => {
  if (!request.auth) {
    return reply.code(401).send({ message: 'Unauthorized' })
  }

  let user

  try {
    user = await findUserById(request.auth.userId)
  } catch (error) {
    request.log.error(error)
    return reply.code(503).send({ message: 'Auth storage unavailable' })
  }

  if (!user) {
    return reply.code(401).send({ message: 'Unauthorized' })
  }

  return reply.code(200).send({
    user: {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
    },
  })
})

server.addHook('onClose', async () => {
  await disconnectRedis()
})

const start = async (): Promise<void> => {
  try {
    await connectRedis()
    await server.listen({ port: authConfig.port, host: authConfig.host })
  } catch (error) {
    server.log.error(error)
    process.exit(1)
  }
}

let isShuttingDown = false

const shutdown = async (signal: string): Promise<void> => {
  if (isShuttingDown) {
    return
  }

  isShuttingDown = true
  server.log.info({ signal }, 'shutting down auth-service')

  const forcedExitTimer = setTimeout(() => {
    process.exit(1)
  }, authConfig.shutdownGracePeriodMs)

  forcedExitTimer.unref()

  try {
    await server.close()
    clearTimeout(forcedExitTimer)
    process.exit(0)
  } catch (error) {
    server.log.error(error)
    process.exit(1)
  }
}

process.once('SIGINT', () => {
  void shutdown('SIGINT')
})

process.once('SIGTERM', () => {
  void shutdown('SIGTERM')
})

void start()
