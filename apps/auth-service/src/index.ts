import { randomUUID } from 'node:crypto'

import bcrypt from 'bcrypt'
import Fastify from 'fastify'

import { authPreHandler } from './auth-middleware.js'
import { authConfig } from './config.js'
import { signAccessToken } from './jwt.js'
import {
  connectRedis,
  createUser,
  findUserByEmail,
  findUserById,
  storeSession,
  type StoredUser,
} from './redis.js'

interface AuthBody {
  email: string
  password: string
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
  logger: true,
})

server.get('/health', async () => {
  return {
    service: 'auth-service',
    status: 'ok',
  }
})

server.post('/register', async (request, reply) => {
  let body: AuthBody

  try {
    body = assertAuthBody(request.body)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bad request'
    return reply.code(400).send({ message })
  }

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
})

server.post('/login', async (request, reply) => {
  let body: AuthBody

  try {
    body = assertAuthBody(request.body)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bad request'
    return reply.code(400).send({ message })
  }

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
})

server.get('/me', { preHandler: authPreHandler }, async (request, reply) => {
  if (!request.auth) {
    return reply.code(401).send({ message: 'Unauthorized' })
  }

  const user = await findUserById(request.auth.userId)

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

const start = async (): Promise<void> => {
  try {
    await connectRedis()
    await server.listen({ port: authConfig.port, host: authConfig.host })
  } catch (error) {
    server.log.error(error)
    process.exit(1)
  }
}

void start()
