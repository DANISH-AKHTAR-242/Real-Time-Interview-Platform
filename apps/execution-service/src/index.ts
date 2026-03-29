import Fastify from 'fastify'

import { registerExecuteRoute } from './api/execute-route.js'
import { registerResultRoute } from './api/result-route.js'
import { executionConfig } from './config.js'
import { codeExecutionQueue } from './queue/code-execution-queue.js'
import { disconnectRedis, pingRedis } from './queue/redis.js'

const server = Fastify({
  logger: true,
})

server.get('/health', async () => {
  return {
    service: 'execution-service',
    status: 'ok',
  }
})

server.get('/ready', async (request, reply) => {
  const redisReady = await pingRedis()

  if (!redisReady) {
    request.log.warn('readiness check failed: redis unavailable')
    return reply.code(503).send({
      service: 'execution-service',
      status: 'degraded',
      dependency: 'redis',
    })
  }

  return reply.code(200).send({
    service: 'execution-service',
    status: 'ready',
  })
})

registerExecuteRoute(server)
registerResultRoute(server)

const start = async (): Promise<void> => {
  try {
    await server.listen({
      host: executionConfig.host,
      port: executionConfig.port,
    })

    server.log.info(
      `execution-service listening on http://${executionConfig.host}:${executionConfig.port}`,
    )
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
  server.log.info({ signal }, 'shutting down execution-service')

  try {
    await server.close()
    await codeExecutionQueue.close()
    await disconnectRedis()
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
