import { createServer } from 'node:http'

import { setupWSConnection } from '@y/websocket-server/utils'
import { WebSocketServer } from 'ws'

import { getOrCreateSessionDoc } from '../yjs/setup.js'

import { authenticateUpgradeRequest, UpgradeAuthError } from './auth.js'
import { collabConfig } from './config.js'

import type { SessionUpgradeContext } from '../types/ws.js'
import type WebSocket from 'ws'

const PORT = collabConfig.port
const HOST = collabConfig.host

let activeConnections = 0

const sendJson = (
  response: import('node:http').ServerResponse,
  statusCode: number,
  body: unknown,
): void => {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(body))
}

const httpServer = createServer((request, response) => {
  if (request.url === '/health') {
    sendJson(response, 200, {
      service: 'collab-service',
      status: 'ok',
      activeConnections,
    })
    return
  }

  if (request.url === '/ready') {
    const hasAuthorizationProvider = Boolean(
      collabConfig.sessionServiceUrl || collabConfig.allowMockSessionAccess,
    )

    if (!hasAuthorizationProvider) {
      sendJson(response, 503, {
        service: 'collab-service',
        status: 'degraded',
        reason: 'SESSION_SERVICE_URL is not configured and mock access is disabled',
      })
      return
    }

    sendJson(response, 200, {
      service: 'collab-service',
      status: 'ready',
    })
    return
  }

  sendJson(response, 404, { message: 'Not found' })
})

const wsServer = new WebSocketServer({
  noServer: true,
  maxPayload: collabConfig.maxPayloadBytes,
  perMessageDeflate: false,
})

const rejectUpgrade = (
  socket: import('node:stream').Duplex,
  statusCode: number,
  message: string,
): void => {
  socket.write(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

const statusText = (statusCode: number): string => {
  if (statusCode === 400) {
    return 'Bad Request'
  }

  if (statusCode === 401) {
    return 'Unauthorized'
  }

  if (statusCode === 403) {
    return 'Forbidden'
  }

  if (statusCode === 503) {
    return 'Service Unavailable'
  }

  return 'Internal Server Error'
}

httpServer.on('upgrade', (request, socket, head) => {
  void (async () => {
    let auth

    try {
      auth = await authenticateUpgradeRequest(request)
    } catch (error) {
      const statusCode = error instanceof UpgradeAuthError ? error.statusCode : 500
      const reason = error instanceof Error ? error.message : 'Internal server error'
      rejectUpgrade(socket, statusCode, statusText(statusCode))
      console.error(`[collab-service] rejected websocket (${statusCode}): ${reason}`)
      return
    }

    wsServer.handleUpgrade(request, socket, head, (client) => {
      const context: SessionUpgradeContext = {
        sessionId: auth.sessionId,
        userId: auth.userId,
        request,
        socket: client,
      }

      wsServer.emit('connection', context.socket, context.request, context)
    })
  })()
})

wsServer.on(
  'connection',
  (
    socket: WebSocket,
    request: import('node:http').IncomingMessage,
    context: SessionUpgradeContext,
  ) => {
    activeConnections += 1

    const trackedSocket = socket as WebSocket & { isAlive?: boolean }
    trackedSocket.isAlive = true

    socket.on('pong', () => {
      trackedSocket.isAlive = true
    })

    const { sessionId, userId } = context
    getOrCreateSessionDoc(sessionId)

    const yRequest = request as import('node:http').IncomingMessage & { url: string }
    yRequest.url = `/${sessionId}`
    setupWSConnection(socket, yRequest, { docName: sessionId })

    console.log(`[collab-service] connected user=${userId} session=${sessionId}`)

    socket.on('close', () => {
      activeConnections = Math.max(0, activeConnections - 1)
      console.log(`[collab-service] disconnected user=${userId} session=${sessionId}`)
    })
  },
)

const heartbeatTimer = setInterval(() => {
  wsServer.clients.forEach((client) => {
    const trackedClient = client as WebSocket & { isAlive?: boolean }

    if (trackedClient.isAlive === false) {
      client.terminate()
      return
    }

    trackedClient.isAlive = false
    client.ping()
  })
}, 30_000)

heartbeatTimer.unref()

const closeHttpServer = (): Promise<void> =>
  new Promise((resolve, reject) => {
    httpServer.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })

let isShuttingDown = false

const shutdown = async (signal: string): Promise<void> => {
  if (isShuttingDown) {
    return
  }

  isShuttingDown = true
  console.log(`[collab-service] shutting down (${signal})`)

  const forcedExitTimer = setTimeout(() => {
    process.exit(1)
  }, collabConfig.shutdownGracePeriodMs)

  forcedExitTimer.unref()

  try {
    clearInterval(heartbeatTimer)
    wsServer.clients.forEach((client) => {
      client.close(1001, 'Server shutting down')
    })

    await closeHttpServer()

    clearTimeout(forcedExitTimer)
    process.exit(0)
  } catch (error) {
    console.error('[collab-service] failed to shut down cleanly', error)
    process.exit(1)
  }
}

process.once('SIGINT', () => {
  void shutdown('SIGINT')
})

process.once('SIGTERM', () => {
  void shutdown('SIGTERM')
})

httpServer.listen(PORT, HOST, () => {
  console.log(`[collab-service] listening on ws://${HOST}:${PORT}`)
})
