import Fastify from 'fastify'

import { createMediasoupRouter } from './mediasoup/router.js'
import { createMediasoupWorker } from './mediasoup/worker.js'
import { createSignalingServer } from './signaling/server.js'

interface IceServerConfig {
  urls: string[]
  username?: string
  credential?: string
}

const parsePort = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10)

  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed
  }

  return fallback
}

const host = process.env.HOST ?? '0.0.0.0'
const port = parsePort(process.env.PORT, 3004)

const parseCsv = (value: string | undefined): string[] => {
  if (!value) {
    return []
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

const getIceServers = (): IceServerConfig[] => {
  const turnHost = process.env.TURN_PUBLIC_HOST ?? 'localhost'

  const stunUrls = parseCsv(process.env.MEDIA_STUN_URLS)
  const turnUrls = parseCsv(process.env.MEDIA_TURN_URLS)

  const resolvedStunUrls = stunUrls.length > 0 ? stunUrls : [`stun:${turnHost}:3478`]

  const resolvedTurnUrls =
    turnUrls.length > 0
      ? turnUrls
      : [`turn:${turnHost}:3478?transport=udp`, `turn:${turnHost}:3478?transport=tcp`]

  const iceServers: IceServerConfig[] = [
    {
      urls: resolvedStunUrls,
    },
  ]

  const turnUsername = process.env.MEDIA_TURN_USERNAME ?? 'username'
  const turnCredential = process.env.MEDIA_TURN_PASSWORD ?? 'password'

  if (resolvedTurnUrls.length > 0) {
    iceServers.push({
      urls: resolvedTurnUrls,
      username: turnUsername,
      credential: turnCredential,
    })
  }

  return iceServers
}

const start = async (): Promise<void> => {
  const worker = await createMediasoupWorker()
  const router = await createMediasoupRouter(worker)
  const iceServers = getIceServers()

  const server = Fastify({
    logger: true,
  })

  server.get('/health', async () => {
    return {
      service: 'media-service',
      status: 'ok',
    }
  })

  server.get('/rtpCapabilities', async () => {
    return router.rtpCapabilities
  })

  server.get('/iceServers', async () => {
    return {
      iceServers,
    }
  })

  const signalingServer = createSignalingServer({
    httpServer: server.server,
    logger: server.log,
    router,
  })

  let isShuttingDown = false

  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) {
      return
    }

    isShuttingDown = true
    server.log.info({ signal }, 'shutting down media-service')

    try {
      await signalingServer.close()
      await server.close()
      worker.close()
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

  await server.listen({ host, port })
  server.log.info({ workerPid: worker.pid }, 'mediasoup worker started')
  server.log.info('mediasoup router created')
}

void start().catch((error) => {
  console.error(error)
  process.exit(1)
})
