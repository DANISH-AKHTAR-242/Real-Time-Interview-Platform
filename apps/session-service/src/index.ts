import { Prisma, SessionStatus } from '@prisma/client'
import Fastify from 'fastify'

import { sessionConfig } from './config.js'
import { connectDatabase, disconnectDatabase, prisma } from './db.js'

interface CreateSessionBody {
  candidateId: string
  interviewerId: string
  status?: SessionStatus
}

interface UpdateSessionBody {
  status: SessionStatus
}

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

const isSessionStatus = (value: unknown): value is SessionStatus => {
  return (
    value === SessionStatus.scheduled ||
    value === SessionStatus.active ||
    value === SessionStatus.completed
  )
}

const parseCreateBody = (body: unknown): CreateSessionBody => {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid request body')
  }

  const { candidateId, interviewerId, status } = body as Partial<CreateSessionBody>

  if (typeof candidateId !== 'string' || !isUuid(candidateId)) {
    throw new Error('candidateId must be a valid UUID')
  }

  if (typeof interviewerId !== 'string' || !isUuid(interviewerId)) {
    throw new Error('interviewerId must be a valid UUID')
  }

  if (candidateId === interviewerId) {
    throw new Error('candidateId and interviewerId must be different')
  }

  if (status !== undefined && !isSessionStatus(status)) {
    throw new Error('status must be one of: scheduled, active, completed')
  }

  return {
    candidateId,
    interviewerId,
    status,
  }
}

const parseUpdateBody = (body: unknown): UpdateSessionBody => {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid request body')
  }

  const { status } = body as Partial<UpdateSessionBody>

  if (!isSessionStatus(status)) {
    throw new Error('status must be one of: scheduled, active, completed')
  }

  return { status }
}

const server = Fastify({
  logger: {
    level: sessionConfig.logLevel,
  },
  trustProxy: sessionConfig.trustProxy,
  bodyLimit: sessionConfig.bodyLimitBytes,
  requestTimeout: sessionConfig.requestTimeoutMs,
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
    service: 'session-service',
    status: 'ok',
  }
})

server.get('/ready', async (request, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`

    return reply.code(200).send({
      service: 'session-service',
      status: 'ready',
    })
  } catch (error) {
    request.log.error(error)

    return reply.code(503).send({
      service: 'session-service',
      status: 'degraded',
      dependency: 'postgres',
    })
  }
})

server.post('/sessions', async (request, reply) => {
  let body: CreateSessionBody

  try {
    body = parseCreateBody(request.body)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bad request'
    return reply.code(400).send({ message })
  }

  try {
    const session = await prisma.session.create({
      data: {
        candidateId: body.candidateId,
        interviewerId: body.interviewerId,
        status: body.status ?? SessionStatus.scheduled,
      },
    })

    return reply.code(201).send({ session })
  } catch (error) {
    request.log.error(error)
    return reply.code(503).send({ message: 'Session storage unavailable' })
  }
})

server.get('/sessions/:id', async (request, reply) => {
  const params = request.params as { id?: string }
  const id = params.id

  if (!id || !isUuid(id)) {
    return reply.code(400).send({ message: 'id must be a valid UUID' })
  }

  let session

  try {
    session = await prisma.session.findUnique({
      where: { id },
    })
  } catch (error) {
    request.log.error(error)
    return reply.code(503).send({ message: 'Session storage unavailable' })
  }

  if (!session) {
    return reply.code(404).send({ message: 'Session not found' })
  }

  return reply.code(200).send({ session })
})

server.patch('/sessions/:id', async (request, reply) => {
  const params = request.params as { id?: string }
  const id = params.id

  if (!id || !isUuid(id)) {
    return reply.code(400).send({ message: 'id must be a valid UUID' })
  }

  let body: UpdateSessionBody

  try {
    body = parseUpdateBody(request.body)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bad request'
    return reply.code(400).send({ message })
  }

  try {
    const session = await prisma.session.update({
      where: { id },
      data: {
        status: body.status,
      },
    })

    return reply.code(200).send({ session })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return reply.code(404).send({ message: 'Session not found' })
    }

    throw error
  }
})

server.addHook('onClose', async () => {
  await disconnectDatabase()
})

const start = async (): Promise<void> => {
  try {
    await connectDatabase()
    await server.listen({ port: sessionConfig.port, host: sessionConfig.host })
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
  server.log.info({ signal }, 'shutting down session-service')

  const forcedExitTimer = setTimeout(() => {
    process.exit(1)
  }, sessionConfig.shutdownGracePeriodMs)

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
