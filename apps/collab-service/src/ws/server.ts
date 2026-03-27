import { createServer } from 'node:http'

import { setupWSConnection } from '@y/websocket-server/utils'
import { WebSocketServer } from 'ws'

import { getOrCreateSessionDoc } from '../yjs/setup.js'

import { authenticateUpgradeRequest } from './auth.js'

import type { SessionUpgradeContext } from '../types/ws.js'
import type WebSocket from 'ws'

const PORT = Number(process.env.PORT ?? 3002)
const HOST = process.env.HOST ?? '0.0.0.0'

const httpServer = createServer()
const wsServer = new WebSocketServer({ noServer: true })

const rejectUpgrade = (socket: import('node:stream').Duplex, statusCode: number, message: string): void => {
  socket.write(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

httpServer.on('upgrade', (request, socket, head) => {
  void (async () => {
    let auth

    try {
      auth = await authenticateUpgradeRequest(request)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unauthorized'
      const statusCode = reason.startsWith('Forbidden') ? 403 : 401
      rejectUpgrade(socket, statusCode, statusCode === 403 ? 'Forbidden' : 'Unauthorized')
      console.error(`[collab-service] rejected websocket: ${reason}`)
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
    const { sessionId, userId } = context
    getOrCreateSessionDoc(sessionId)

    const yRequest = request as import('node:http').IncomingMessage & { url: string }
    yRequest.url = `/${sessionId}`
    setupWSConnection(socket, yRequest, { docName: sessionId })

    console.log(`[collab-service] connected user=${userId} session=${sessionId}`)

    socket.on('close', () => {
      console.log(`[collab-service] disconnected user=${userId} session=${sessionId}`)
    })
  },
)

httpServer.listen(PORT, HOST, () => {
  console.log(`[collab-service] listening on ws://${HOST}:${PORT}`)
})
