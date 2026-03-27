import Fastify from 'fastify'

const PORT = Number(process.env.PORT ?? 3001)
const HOST = process.env.HOST ?? '0.0.0.0'

const server = Fastify({
  logger: true,
})

server.get('/health', async () => {
  return {
    service: 'auth-service',
    status: 'ok',
  }
})

const start = async (): Promise<void> => {
  try {
    await server.listen({ port: PORT, host: HOST })
  } catch (error) {
    server.log.error(error)
    process.exit(1)
  }
}

void start()
