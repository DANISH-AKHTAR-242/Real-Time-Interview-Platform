import { randomUUID } from 'node:crypto'

import { WebSocket, WebSocketServer, type RawData } from 'ws'

import { connectWebRtcTransport, createWebRtcTransport } from '../mediasoup/transport.js'

import type { FastifyBaseLogger } from 'fastify'
import type {
  Consumer,
  DtlsParameters,
  MediaKind,
  Producer,
  Router,
  RtpCapabilities,
  RtpParameters,
  WebRtcTransport,
} from 'mediasoup/node/lib/types'
import type { Server as HttpServer } from 'node:http'

interface IncomingMessage {
  event: string
  requestId?: string
  data?: unknown
}

interface PeerState {
  id: string
  socket: WebSocket
  roomId: string | null
  transports: Map<string, WebRtcTransport>
  producers: Map<string, Producer>
  consumers: Map<string, Consumer>
}

interface RoomState {
  id: string
  peers: Set<string>
  producerPeerById: Map<string, string>
}

interface SignalingServerOptions {
  httpServer: HttpServer
  logger: FastifyBaseLogger
  router: Router
}

interface RemovePeerFromRoomOptions {
  notify?: boolean
  reason?: 'disconnect' | 'room-switch' | 'server-close'
}

interface ConnectTransportRequest {
  transportId: string
  dtlsParameters: DtlsParameters
}

interface ProduceRequest {
  transportId: string
  kind: MediaKind
  rtpParameters: RtpParameters
  appData?: Record<string, unknown>
}

interface ConsumeRequest {
  transportId: string
  producerId: string
  rtpCapabilities: RtpCapabilities
}

export interface SignalingServer {
  close: () => Promise<void>
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const parseJsonMessage = (rawData: RawData): IncomingMessage => {
  let textPayload = ''

  if (typeof rawData === 'string') {
    textPayload = rawData
  } else if (rawData instanceof ArrayBuffer) {
    textPayload = Buffer.from(rawData).toString('utf8')
  } else if (Array.isArray(rawData)) {
    textPayload = Buffer.concat(rawData).toString('utf8')
  } else {
    textPayload = rawData.toString('utf8')
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(textPayload)
  } catch {
    throw new Error('Message must be valid JSON')
  }

  if (!isRecord(parsed)) {
    throw new Error('Message must be an object')
  }

  const { event, requestId, data } = parsed

  if (typeof event !== 'string' || event.length === 0) {
    throw new Error('Message must include a non-empty event')
  }

  if (requestId !== undefined && typeof requestId !== 'string') {
    throw new Error('requestId must be a string when provided')
  }

  return {
    event,
    requestId,
    data,
  }
}

const assertRecord = (value: unknown, fieldName: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} must be an object`)
  }

  return value
}

const assertString = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`)
  }

  return value
}

const normalizeErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unknown error'
}

const parsePositiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10)

  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed
  }

  return fallback
}

export const createSignalingServer = ({
  httpServer,
  logger,
  router,
}: SignalingServerOptions): SignalingServer => {
  const rooms = new Map<string, RoomState>()
  const peers = new Map<string, PeerState>()
  const signalingServer = new WebSocketServer({ noServer: true })
  const maxPeersPerRoom = parsePositiveInteger(process.env.MEDIA_ROOM_MAX_PEERS, 5)

  const send = (socket: WebSocket, payload: Record<string, unknown>): void => {
    if (socket.readyState !== WebSocket.OPEN) {
      return
    }

    socket.send(JSON.stringify(payload))
  }

  const sendAck = (
    peer: PeerState,
    action: string,
    requestId: string | undefined,
    data: Record<string, unknown>,
  ): void => {
    send(peer.socket, {
      event: 'ack',
      action,
      requestId,
      data,
    })
  }

  const sendError = (
    peer: PeerState,
    action: string | undefined,
    requestId: string | undefined,
    message: string,
  ): void => {
    send(peer.socket, {
      event: 'error',
      action,
      requestId,
      message,
    })
  }

  const getOrCreateRoom = (roomId: string): RoomState => {
    const existing = rooms.get(roomId)

    if (existing) {
      return existing
    }

    const created: RoomState = {
      id: roomId,
      peers: new Set<string>(),
      producerPeerById: new Map<string, string>(),
    }

    rooms.set(roomId, created)
    return created
  }

  const broadcastToRoom = (
    roomId: string,
    event: string,
    data: Record<string, unknown>,
    excludedPeerId?: string,
  ): void => {
    const room = rooms.get(roomId)

    if (!room) {
      return
    }

    for (const peerId of room.peers) {
      if (peerId === excludedPeerId) {
        continue
      }

      const peer = peers.get(peerId)

      if (!peer) {
        continue
      }

      send(peer.socket, {
        event,
        data,
      })
    }
  }

  const removePeerFromRoom = (peer: PeerState, options?: RemovePeerFromRoomOptions): void => {
    if (!peer.roomId) {
      return
    }

    const room = rooms.get(peer.roomId)

    if (room) {
      const roomId = room.id
      room.peers.delete(peer.id)

      if (options?.notify) {
        broadcastToRoom(roomId, 'peerLeft', {
          sessionId: roomId,
          peerId: peer.id,
          peerCount: room.peers.size,
          reason: options.reason ?? 'disconnect',
        })
      }

      if (room.peers.size === 0) {
        rooms.delete(room.id)
      }
    }

    peer.roomId = null
  }

  const closePeerMedia = (peer: PeerState): void => {
    const roomId = peer.roomId

    for (const [consumerId, consumer] of peer.consumers) {
      peer.consumers.delete(consumerId)
      consumer.close()
    }

    for (const [producerId, producer] of peer.producers) {
      if (roomId) {
        const room = rooms.get(roomId)

        if (room) {
          room.producerPeerById.delete(producerId)
          broadcastToRoom(
            roomId,
            'producerClosed',
            {
              sessionId: roomId,
              peerId: peer.id,
              producerId,
            },
            peer.id,
          )
        }
      }

      peer.producers.delete(producerId)
      producer.close()
    }

    for (const [transportId, transport] of peer.transports) {
      peer.transports.delete(transportId)
      transport.close()
    }
  }

  const cleanupPeer = (peer: PeerState): void => {
    if (!peers.has(peer.id)) {
      return
    }

    closePeerMedia(peer)
    removePeerFromRoom(peer, {
      notify: true,
      reason: 'disconnect',
    })
    peers.delete(peer.id)
  }

  const ensureRoomJoined = (peer: PeerState): RoomState => {
    if (!peer.roomId) {
      throw new Error('joinRoom must be called before this event')
    }

    const room = rooms.get(peer.roomId)

    if (!room) {
      throw new Error('Room does not exist')
    }

    return room
  }

  const handleJoinRoom = (
    peer: PeerState,
    requestId: string | undefined,
    payload: unknown,
  ): void => {
    const data = assertRecord(payload, 'joinRoom payload')
    const sessionId = assertString(data.sessionId, 'sessionId')
    const currentRoomId = peer.roomId
    const alreadyInRoom = currentRoomId === sessionId

    if (currentRoomId && currentRoomId !== sessionId) {
      closePeerMedia(peer)
      removePeerFromRoom(peer, {
        notify: true,
        reason: 'room-switch',
      })
    }

    const room = getOrCreateRoom(sessionId)

    if (!alreadyInRoom && room.peers.size >= maxPeersPerRoom) {
      throw new Error(`Room is full (max ${maxPeersPerRoom} peers)`)
    }

    peer.roomId = sessionId
    room.peers.add(peer.id)

    const existingProducerIds: string[] = []
    const existingPeerIds: string[] = []

    for (const [producerId, producerPeerId] of room.producerPeerById) {
      if (producerPeerId !== peer.id) {
        existingProducerIds.push(producerId)
      }
    }

    for (const roomPeerId of room.peers) {
      if (roomPeerId !== peer.id) {
        existingPeerIds.push(roomPeerId)
      }
    }

    sendAck(peer, 'joinRoom', requestId, {
      peerId: peer.id,
      sessionId,
      existingPeerIds,
      existingProducerIds,
      peerCount: room.peers.size,
    })

    if (!alreadyInRoom) {
      broadcastToRoom(
        sessionId,
        'peerJoined',
        {
          sessionId,
          peerId: peer.id,
          peerCount: room.peers.size,
        },
        peer.id,
      )
    }
  }

  const handleCreateTransport = async (
    peer: PeerState,
    requestId: string | undefined,
    payload: unknown,
  ): Promise<void> => {
    ensureRoomJoined(peer)

    const data = payload === undefined ? {} : assertRecord(payload, 'createTransport payload')
    const directionValue = data.direction
    const direction =
      directionValue === 'send' || directionValue === 'recv' ? directionValue : 'send'

    const { transport, params } = await createWebRtcTransport(router)

    peer.transports.set(transport.id, transport)

    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') {
        peer.transports.delete(transport.id)
        transport.close()
      }
    })

    sendAck(peer, 'createTransport', requestId, {
      direction,
      transportId: params.id,
      id: params.id,
      iceParameters: params.iceParameters,
      iceCandidates: params.iceCandidates,
      dtlsParameters: params.dtlsParameters,
    })
  }

  const handleConnectTransport = async (
    peer: PeerState,
    requestId: string | undefined,
    payload: unknown,
  ): Promise<void> => {
    ensureRoomJoined(peer)

    const data = assertRecord(
      payload,
      'connectTransport payload',
    ) as unknown as ConnectTransportRequest
    const transportId = assertString(data.transportId, 'transportId')
    const transport = peer.transports.get(transportId)

    if (!transport) {
      throw new Error('Transport not found')
    }

    if (!isRecord(data.dtlsParameters)) {
      throw new Error('dtlsParameters must be an object')
    }

    await connectWebRtcTransport(transport, data.dtlsParameters)

    sendAck(peer, 'connectTransport', requestId, {
      transportId,
      connected: true,
    })
  }

  const handleProduce = async (
    peer: PeerState,
    requestId: string | undefined,
    payload: unknown,
  ): Promise<void> => {
    const room = ensureRoomJoined(peer)
    const data = assertRecord(payload, 'produce payload') as unknown as ProduceRequest
    const transportId = assertString(data.transportId, 'transportId')
    const transport = peer.transports.get(transportId)

    if (!transport) {
      throw new Error('Transport not found')
    }

    const kindValue = assertString(data.kind, 'kind')

    if (kindValue !== 'audio' && kindValue !== 'video') {
      throw new Error('kind must be either audio or video')
    }

    if (!isRecord(data.rtpParameters)) {
      throw new Error('rtpParameters must be an object')
    }

    const producer = await transport.produce({
      kind: kindValue,
      rtpParameters: data.rtpParameters,
      appData: data.appData,
    })

    peer.producers.set(producer.id, producer)
    room.producerPeerById.set(producer.id, peer.id)

    const detachProducer = (): void => {
      if (!peer.producers.has(producer.id)) {
        return
      }

      peer.producers.delete(producer.id)

      const activeRoomId = peer.roomId

      if (!activeRoomId) {
        return
      }

      const activeRoom = rooms.get(activeRoomId)

      if (!activeRoom) {
        return
      }

      activeRoom.producerPeerById.delete(producer.id)
      broadcastToRoom(
        activeRoomId,
        'producerClosed',
        {
          sessionId: activeRoomId,
          peerId: peer.id,
          producerId: producer.id,
        },
        peer.id,
      )
    }

    producer.on('transportclose', detachProducer)

    broadcastToRoom(
      room.id,
      'newProducer',
      {
        sessionId: room.id,
        peerId: peer.id,
        producerId: producer.id,
        kind: producer.kind,
      },
      peer.id,
    )

    sendAck(peer, 'produce', requestId, {
      producerId: producer.id,
      kind: producer.kind,
    })
  }

  const handleConsume = async (
    peer: PeerState,
    requestId: string | undefined,
    payload: unknown,
  ): Promise<void> => {
    const room = ensureRoomJoined(peer)
    const data = assertRecord(payload, 'consume payload') as unknown as ConsumeRequest
    const transportId = assertString(data.transportId, 'transportId')
    const producerId = assertString(data.producerId, 'producerId')
    const transport = peer.transports.get(transportId)

    if (!transport) {
      throw new Error('Transport not found')
    }

    if (!room.producerPeerById.has(producerId)) {
      throw new Error('Producer does not exist in this room')
    }

    if (!isRecord(data.rtpCapabilities)) {
      throw new Error('rtpCapabilities must be an object')
    }

    if (!router.canConsume({ producerId, rtpCapabilities: data.rtpCapabilities })) {
      throw new Error('Cannot consume this producer with given rtpCapabilities')
    }

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities: data.rtpCapabilities,
    })

    peer.consumers.set(consumer.id, consumer)

    consumer.on('transportclose', () => {
      peer.consumers.delete(consumer.id)
    })

    consumer.on('producerclose', () => {
      peer.consumers.delete(consumer.id)

      send(peer.socket, {
        event: 'consumerClosed',
        data: {
          consumerId: consumer.id,
          producerId,
        },
      })
    })

    sendAck(peer, 'consume', requestId, {
      consumerId: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      type: consumer.type,
      producerPaused: consumer.producerPaused,
      producerPeerId: room.producerPeerById.get(producerId),
    })
  }

  const handleIncomingMessage = async (peer: PeerState, rawData: RawData): Promise<void> => {
    let action: string | undefined
    let requestId: string | undefined

    try {
      const message = parseJsonMessage(rawData)
      action = message.event
      requestId = message.requestId

      switch (message.event) {
        case 'joinRoom':
          handleJoinRoom(peer, requestId, message.data)
          break
        case 'createTransport':
          await handleCreateTransport(peer, requestId, message.data)
          break
        case 'connectTransport':
          await handleConnectTransport(peer, requestId, message.data)
          break
        case 'produce':
          await handleProduce(peer, requestId, message.data)
          break
        case 'consume':
          await handleConsume(peer, requestId, message.data)
          break
        default:
          throw new Error(`Unsupported event: ${message.event}`)
      }
    } catch (error) {
      const errorMessage = normalizeErrorMessage(error)
      logger.warn({ action, requestId, error: errorMessage }, 'signaling request failed')
      sendError(peer, action, requestId, errorMessage)
    }
  }

  signalingServer.on('connection', (socket: WebSocket) => {
    const peer: PeerState = {
      id: randomUUID(),
      socket,
      roomId: null,
      transports: new Map<string, WebRtcTransport>(),
      producers: new Map<string, Producer>(),
      consumers: new Map<string, Consumer>(),
    }

    peers.set(peer.id, peer)

    send(peer.socket, {
      event: 'connected',
      data: {
        peerId: peer.id,
      },
    })

    socket.on('message', (rawData: RawData) => {
      void handleIncomingMessage(peer, rawData)
    })

    socket.on('close', () => {
      cleanupPeer(peer)
      logger.info({ peerId: peer.id }, 'peer disconnected')
    })

    socket.on('error', (error: Error) => {
      logger.warn({ peerId: peer.id, error }, 'peer socket error')
    })
  })

  const onUpgrade = (
    request: Parameters<typeof signalingServer.handleUpgrade>[0],
    socket: Parameters<typeof signalingServer.handleUpgrade>[1],
    head: Parameters<typeof signalingServer.handleUpgrade>[2],
  ): void => {
    const requestUrl = request.url ?? '/'

    let pathname = '/'

    try {
      pathname = new URL(requestUrl, 'http://localhost').pathname
    } catch {
      socket.destroy()
      return
    }

    if (pathname !== '/ws') {
      socket.destroy()
      return
    }

    signalingServer.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      signalingServer.emit('connection', ws, request)
    })
  }

  httpServer.on('upgrade', onUpgrade)

  let isClosed = false

  const close = async (): Promise<void> => {
    if (isClosed) {
      return
    }

    isClosed = true
    httpServer.off('upgrade', onUpgrade)

    for (const peer of peers.values()) {
      closePeerMedia(peer)
      removePeerFromRoom(peer, {
        notify: true,
        reason: 'server-close',
      })
      peers.delete(peer.id)
      peer.socket.close()
    }

    await new Promise<void>((resolve) => {
      signalingServer.close(() => {
        resolve()
      })
    })

    rooms.clear()
    peers.clear()
  }

  logger.info('websocket signaling server attached on /ws')

  return {
    close,
  }
}
