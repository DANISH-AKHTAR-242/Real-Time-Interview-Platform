import { createServer } from 'node:http'

import { setupWSConnection } from '@y/websocket-server/utils'
import { WebSocketServer } from 'ws'

import { getOrCreateSessionDoc } from '../yjs/setup.js'

import type { SessionUpgradeContext } from '../types/ws.js'
import type WebSocket from 'ws'

const PORT = Number(process.env.PORT ?? 3002)
const HOST = process.env.HOST ?? '0.0.0.0'

const extractSessionId = (url: string | undefined): string | null => {
  if (!url) {
    return null
  }

  const [path = ''] = url.split('?')
  const sessionId = path.replace(/^\//, '')

  if (!sessionId) {
    return null
  }

  return sessionId
}

const httpServer = createServer()

const wsServer = new WebSocketServer({ noServer: true })

httpServer.on('upgrade', (request, socket, head) => {
  const sessionId = extractSessionId(request.url)

  if (!sessionId) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
    socket.destroy()
    return
  }

  wsServer.handleUpgrade(request, socket, head, (client) => {
    const context: SessionUpgradeContext = {
      sessionId,
      request,
      socket: client,
    }

    wsServer.emit('connection', context.socket, context.request, context)
  })
})

wsServer.on(
  'connection',
  (
    socket: WebSocket,
    request: import('node:http').IncomingMessage,
    context: SessionUpgradeContext,
  ) => {
  const { sessionId } = context
  getOrCreateSessionDoc(sessionId)

  const yRequest = request as import('node:http').IncomingMessage & { url: string }
  yRequest.url = `/${sessionId}`
  setupWSConnection(socket, yRequest, { docName: sessionId })

  console.log(`[collab-service] connected session=${sessionId}`)

  socket.on('close', () => {
    console.log(`[collab-service] disconnected session=${sessionId}`)
  })
  },
)

httpServer.listen(PORT, HOST, () => {
  console.log(`[collab-service] listening on ws://${HOST}:${PORT}`)
})
