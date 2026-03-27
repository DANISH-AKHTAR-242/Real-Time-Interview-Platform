/**
 * Collab-Service Monitoring & Debugging Tool
 * 
 * Usage:
 * 1. Add to collab-service/src/ws/server.ts
 * 2. Exposes metrics endpoint on /metrics
 * 3. Can be queried via: curl http://localhost:3002/metrics
 * 
 * Metrics tracked:
 * - Active connections
 * - Messages processed
 * - Document states
 * - Latency
 * - Error rates
 */

import type { WebSocket } from 'ws'

export interface ClientMetrics {
  id: string
  sessionId: string
  userId: string
  connectedAt: Date
  messageCount: number
  bytesReceived: number
  bytesSent: number
  latencies: number[]
  lastMessageAt: Date | null
  state: 'connected' | 'disconnected'
}

export interface SessionMetrics {
  sessionId: string
  createdAt: Date
  clientCount: number
  clients: ClientMetrics[]
  totalMessages: number
  documentSize: number | null
}

export interface ServerMetrics {
  uptime: number
  activeConnections: number
  activeSessions: Map<string, SessionMetrics>
  totalMessagesProcessed: number
  avgLatency: number
  peakConnections: number
  errors: {
    authFailures: number
    disconnectErrors: number
    syncErrors: number
  }
}

class MetricsCollector {
  private metrics: ServerMetrics
  private clientMetrics: Map<WebSocket, ClientMetrics> = new Map()
  private sessionDocSizes: Map<string, number> = new Map()
  private startTime: Date

  constructor() {
    this.startTime = new Date()
    this.metrics = {
      uptime: 0,
      activeConnections: 0,
      activeSessions: new Map(),
      totalMessagesProcessed: 0,
      avgLatency: 0,
      peakConnections: 0,
      errors: {
        authFailures: 0,
        disconnectErrors: 0,
        syncErrors: 0,
      },
    }
  }

  recordClientConnection(
    socket: WebSocket,
    sessionId: string,
    userId: string
  ): void {
    const clientId = `${userId}-${Math.random().toString(36).slice(2, 9)}`

    const clientMetrics: ClientMetrics = {
      id: clientId,
      sessionId,
      userId,
      connectedAt: new Date(),
      messageCount: 0,
      bytesReceived: 0,
      bytesSent: 0,
      latencies: [],
      lastMessageAt: null,
      state: 'connected',
    }

    this.clientMetrics.set(socket, clientMetrics)

    // Update session metrics
    let session = this.metrics.activeSessions.get(sessionId)
    if (!session) {
      session = {
        sessionId,
        createdAt: new Date(),
        clientCount: 0,
        clients: [],
        totalMessages: 0,
        documentSize: null,
      }
      this.metrics.activeSessions.set(sessionId, session)
    }

    session.clients.push(clientMetrics)
    session.clientCount++
    this.metrics.activeConnections++

    if (this.metrics.activeConnections > this.metrics.peakConnections) {
      this.metrics.peakConnections = this.metrics.activeConnections
    }

    console.log(
      `[metrics] Client connected: ${clientId} (Session: ${sessionId}, Total: ${this.metrics.activeConnections})`
    )
  }

  recordClientDisconnection(socket: WebSocket, sessionId: string): void {
    const clientMetrics = this.clientMetrics.get(socket)
    if (clientMetrics) {
      clientMetrics.state = 'disconnected'
      this.metrics.activeConnections--

      const session = this.metrics.activeSessions.get(sessionId)
      if (session) {
        session.clientCount--
        if (session.clientCount === 0) {
          this.metrics.activeSessions.delete(sessionId)
          console.log(`[metrics] Session ended: ${sessionId}`)
        }
      }
    }
  }

  recordMessage(socket: WebSocket, data: Buffer, direction: 'in' | 'out'): void {
    const clientMetrics = this.clientMetrics.get(socket)
    if (!clientMetrics) return

    clientMetrics.messageCount++
    clientMetrics.lastMessageAt = new Date()

    if (direction === 'in') {
      clientMetrics.bytesReceived += data.length
    } else {
      clientMetrics.bytesSent += data.length
    }

    const session = this.metrics.activeSessions.get(clientMetrics.sessionId)
    if (session) {
      session.totalMessages++
    }

    this.metrics.totalMessagesProcessed++
  }

  recordLatency(socket: WebSocket, latencyMs: number): void {
    const clientMetrics = this.clientMetrics.get(socket)
    if (!clientMetrics) return

    clientMetrics.latencies.push(latencyMs)
    
    // Keep only last 100 latency measurements to avoid memory bloat
    if (clientMetrics.latencies.length > 100) {
      clientMetrics.latencies.shift()
    }

    // Update average latency across all clients
    const allLatencies: number[] = []
    this.clientMetrics.forEach((metrics) => {
      allLatencies.push(...metrics.latencies)
    })
    this.metrics.avgLatency =
      allLatencies.length > 0
        ? allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length
        : 0
  }

  recordAuthFailure(): void {
    this.metrics.errors.authFailures++
  }

  recordSyncError(): void {
    this.metrics.errors.syncErrors++
  }

  recordDisconnectError(): void {
    this.metrics.errors.disconnectErrors++
  }

  updateSessionDocumentSize(sessionId: string, size: number): void {
    const session = this.metrics.activeSessions.get(sessionId)
    if (session) {
      session.documentSize = size
    }
    this.sessionDocSizes.set(sessionId, size)
  }

  getMetrics(): {
    uptime: string
    activeConnections: number
    activeSessions: number
    totalMessagesProcessed: number
    avgLatencyMs: number
    peakConnections: number
    errors: {
      authFailures: number
      disconnectErrors: number
      syncErrors: number
    }
    sessions: Array<{
      sessionId: string
      uptime: string
      clientCount: number
      totalMessages: number
      documentSizeBytes: number | null
      clients: Array<{
        userId: string
        connectedTime: string
        messageCount: number
        bytesReceived: number
        bytesSent: number
        avgLatencyMs: number
        state: string
      }>
    }>
  } {
    const uptimeMs = Date.now() - this.startTime.getTime()
    const uptime = this.formatDuration(uptimeMs)

    const sessions = Array.from(this.metrics.activeSessions.values()).map(
      (session) => ({
        sessionId: session.sessionId,
        uptime: this.formatDuration(
          Date.now() - session.createdAt.getTime()
        ),
        clientCount: session.clientCount,
        totalMessages: session.totalMessages,
        documentSizeBytes: session.documentSize,
        clients: session.clients.map((client) => ({
          userId: client.userId,
          connectedTime: this.formatDuration(
            Date.now() - client.connectedAt.getTime()
          ),
          messageCount: client.messageCount,
          bytesReceived: client.bytesReceived,
          bytesSent: client.bytesSent,
          avgLatencyMs:
            client.latencies.length > 0
              ? (
                  client.latencies.reduce((a, b) => a + b, 0) /
                  client.latencies.length
                ).toFixed(2)
              : 0,
          state: client.state,
        })),
      })
    )

    return {
      uptime,
      activeConnections: this.metrics.activeConnections,
      activeSessions: this.metrics.activeSessions.size,
      totalMessagesProcessed: this.metrics.totalMessagesProcessed,
      avgLatencyMs: parseFloat(this.metrics.avgLatency.toFixed(2)),
      peakConnections: this.metrics.peakConnections,
      errors: this.metrics.errors,
      sessions,
    }
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}d ${hours % 24}h`
    if (hours > 0) return `${hours}h ${minutes % 60}m`
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
  }

  getHealthStatus(): {
    status: 'healthy' | 'degraded' | 'critical'
    reason: string
  } {
    const errorRate =
      this.metrics.totalMessagesProcessed > 0
        ? (
            (this.metrics.errors.syncErrors +
              this.metrics.errors.authFailures) /
            this.metrics.totalMessagesProcessed
          ).toFixed(4)
        : '0'

    if (
      this.metrics.errors.syncErrors > 10 ||
      this.metrics.activeConnections === 0
    ) {
      return {
        status: 'critical',
        reason: `High error rate (${errorRate}) or no active connections`,
      }
    }

    if (
      this.metrics.avgLatency > 500 ||
      this.metrics.errors.authFailures > 5
    ) {
      return {
        status: 'degraded',
        reason: `High latency (${this.metrics.avgLatency.toFixed(2)}ms) or auth failures`,
      }
    }

    return {
      status: 'healthy',
      reason: 'All systems nominal',
    }
  }
}

export const metricsCollector = new MetricsCollector()

/**
 * Middleware to add to HTTP server for /metrics endpoint
 * 
 * Usage in server.ts:
 * ```
 * httpServer.on('request', (req, res) => {
 *   if (req.url === '/metrics') {
 *     const metrics = metricsCollector.getMetrics();
 *     res.writeHead(200, { 'Content-Type': 'application/json' });
 *     res.end(JSON.stringify(metrics, null, 2));
 *   }
 * });
 * ```
 */
export function setupMetricsEndpoint(httpServer: any): void {
  httpServer.on('request', (req: any, res: any) => {
    if (req.url === '/metrics') {
      const metrics = metricsCollector.getMetrics()
      const health = metricsCollector.getHealthStatus()

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(
        JSON.stringify(
          {
            ...metrics,
            health,
          },
          null,
          2
        )
      )
      return
    }

    if (req.url === '/health') {
      const health = metricsCollector.getHealthStatus()
      const statusCode = health.status === 'critical' ? 503 : 200

      res.writeHead(statusCode, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(health))
      return
    }
  })
}

// ============================================================================
// USAGE EXAMPLE
// ============================================================================

/*
// In collab-service/src/ws/server.ts add:

import { metricsCollector, setupMetricsEndpoint } from './metrics.js'

// After creating httpServer:
setupMetricsEndpoint(httpServer)

// Track client connections:
wsServer.on('connection', (socket, request, context) => {
  const { sessionId, userId } = context
  
  metricsCollector.recordClientConnection(socket, sessionId, userId)

  socket.on('close', () => {
    metricsCollector.recordClientDisconnection(socket, sessionId)
  })

  // Optionally track messages:
  socket.on('message', (data) => {
    metricsCollector.recordMessage(socket, data, 'in')
    const latency = Math.random() * 100 // Replace with actual latency
    metricsCollector.recordLatency(socket, latency)
  })
})

// Then query metrics:
// curl http://localhost:3002/metrics
// curl http://localhost:3002/health
*/
