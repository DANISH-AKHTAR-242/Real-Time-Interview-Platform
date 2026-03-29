import type { IncomingMessage } from 'node:http'
import type WebSocket from 'ws'

export interface SessionUpgradeContext {
  sessionId: string
  userId: string
  request: IncomingMessage
  socket: WebSocket
}
