import { Device } from 'mediasoup-client'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { types as MediasoupTypes } from 'mediasoup-client'

type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'failed'

interface UseMediasoupConnectionOptions {
  sessionId: string
  httpBaseUrl: string
  wsUrl: string
}

interface PendingRequest {
  action: string
  resolve: (data: Record<string, unknown>) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

interface MediaTransportResponse {
  id: string
  iceParameters: MediasoupTypes.IceParameters
  iceCandidates: MediasoupTypes.IceCandidate[]
  dtlsParameters: MediasoupTypes.DtlsParameters
}

interface ConsumeResponse {
  consumerId: string
  producerId: string
  kind: MediasoupTypes.MediaKind
  rtpParameters: MediasoupTypes.RtpParameters
  producerPeerId?: string
}

interface IceServersResponse {
  iceServers: globalThis.RTCIceServer[]
}

export interface RemotePeerMedia {
  peerId: string
  stream: globalThis.MediaStream
  audioProducerCount: number
  videoProducerCount: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const readString = (record: Record<string, unknown>, key: string, fallback?: string): string => {
  const value = record[key]

  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }

  if (fallback !== undefined) {
    return fallback
  }

  throw new Error(`Missing or invalid field: ${key}`)
}

const readOptionalString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key]

  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }

  return undefined
}

const parseIceServer = (value: unknown): globalThis.RTCIceServer | null => {
  if (!isRecord(value)) {
    return null
  }

  const urlsValue = value.urls

  let urls: string | string[]

  if (typeof urlsValue === 'string' && urlsValue.trim().length > 0) {
    urls = urlsValue
  } else if (Array.isArray(urlsValue)) {
    const parsedUrls = urlsValue.filter((entry): entry is string => {
      return typeof entry === 'string' && entry.trim().length > 0
    })

    if (parsedUrls.length === 0) {
      return null
    }

    urls = parsedUrls
  } else {
    return null
  }

  const username = readOptionalString(value, 'username')
  const credential = readOptionalString(value, 'credential')

  return {
    urls,
    ...(username ? { username } : {}),
    ...(credential ? { credential } : {}),
  }
}

const parseIceServersResponse = (value: unknown): IceServersResponse => {
  if (!isRecord(value) || !Array.isArray(value.iceServers)) {
    return {
      iceServers: [],
    }
  }

  const iceServers = value.iceServers
    .map((iceServer) => parseIceServer(iceServer))
    .filter((iceServer): iceServer is globalThis.RTCIceServer => iceServer !== null)

  return {
    iceServers,
  }
}

const asError = (error: unknown, fallback: string): Error => {
  if (error instanceof Error) {
    return error
  }

  return new Error(fallback)
}

const buildHttpUrl = (baseUrl: string, path: string): string => {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  return `${normalizedBaseUrl}${normalizedPath}`
}

export const useMediasoupConnection = ({
  sessionId,
  httpBaseUrl,
  wsUrl,
}: UseMediasoupConnectionOptions) => {
  const [status, setStatus] = useState<ConnectionStatus>('idle')
  const [error, setError] = useState('')
  const [peerId, setPeerId] = useState<string | null>(null)
  const [deviceReady, setDeviceReady] = useState(false)
  const [sendTransportId, setSendTransportId] = useState<string | null>(null)
  const [recvTransportId, setRecvTransportId] = useState<string | null>(null)
  const [localAudioProducerId, setLocalAudioProducerId] = useState<string | null>(null)
  const [localVideoProducerId, setLocalVideoProducerId] = useState<string | null>(null)
  const [localStream, setLocalStream] = useState<globalThis.MediaStream | null>(null)
  const [consumerCount, setConsumerCount] = useState(0)
  const [iceServerCount, setIceServerCount] = useState(0)
  const [remotePeers, setRemotePeers] = useState<RemotePeerMedia[]>([])

  const wsRef = useRef<WebSocket | null>(null)
  const requestCounterRef = useRef(0)
  const pendingRequestsRef = useRef<Map<string, PendingRequest>>(new Map())

  const deviceRef = useRef<Device | null>(null)
  const sendTransportRef = useRef<MediasoupTypes.Transport | null>(null)
  const recvTransportRef = useRef<MediasoupTypes.Transport | null>(null)

  const producersRef = useRef<Map<MediasoupTypes.MediaKind, MediasoupTypes.Producer>>(new Map())
  const localStreamRef = useRef<globalThis.MediaStream | null>(null)
  const consumersByProducerIdRef = useRef<Map<string, MediasoupTypes.Consumer>>(new Map())
  const consumingProducerIdsRef = useRef<Set<string>>(new Set())
  const pendingProducerPeerIdsRef = useRef<Map<string, string | undefined>>(new Map())
  const producerPeerIdRef = useRef<Map<string, string>>(new Map())
  const producerTrackRef = useRef<Map<string, globalThis.MediaStreamTrack>>(new Map())
  const remotePeerStreamsRef = useRef<
    Map<
      string,
      { stream: globalThis.MediaStream; producerKinds: Map<string, MediasoupTypes.MediaKind> }
    >
  >(new Map())

  const clearPendingRequests = useCallback((reason: string): void => {
    for (const pending of pendingRequestsRef.current.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(reason))
    }

    pendingRequestsRef.current.clear()
  }, [])

  const resetMediaState = useCallback((): void => {
    for (const consumer of consumersByProducerIdRef.current.values()) {
      consumer.close()
    }

    consumersByProducerIdRef.current.clear()
    consumingProducerIdsRef.current.clear()
    pendingProducerPeerIdsRef.current.clear()
    producerPeerIdRef.current.clear()
    producerTrackRef.current.clear()
    remotePeerStreamsRef.current.clear()
    setConsumerCount(0)
    setIceServerCount(0)
    setRemotePeers([])

    for (const producer of producersRef.current.values()) {
      producer.close()
    }

    producersRef.current.clear()

    setLocalAudioProducerId(null)
    setLocalVideoProducerId(null)

    if (sendTransportRef.current) {
      sendTransportRef.current.close()
      sendTransportRef.current = null
    }

    if (recvTransportRef.current) {
      recvTransportRef.current.close()
      recvTransportRef.current = null
    }

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop()
      }

      localStreamRef.current = null
    }

    setLocalStream(null)

    deviceRef.current = null

    setDeviceReady(false)
    setSendTransportId(null)
    setRecvTransportId(null)
  }, [])

  const setProducerIdByKind = useCallback(
    (kind: MediasoupTypes.MediaKind, producerId: string | null): void => {
      if (kind === 'audio') {
        setLocalAudioProducerId(producerId)
      }

      if (kind === 'video') {
        setLocalVideoProducerId(producerId)
      }
    },
    [],
  )

  const syncRemotePeers = useCallback((): void => {
    const nextRemotePeers = Array.from(remotePeerStreamsRef.current.entries())
      .map(([remotePeerId, remotePeerState]) => {
        let audioProducerCount = 0
        let videoProducerCount = 0

        for (const kind of remotePeerState.producerKinds.values()) {
          if (kind === 'audio') {
            audioProducerCount += 1
          }

          if (kind === 'video') {
            videoProducerCount += 1
          }
        }

        return {
          peerId: remotePeerId,
          stream: remotePeerState.stream,
          audioProducerCount,
          videoProducerCount,
        }
      })
      .sort((left, right) => left.peerId.localeCompare(right.peerId))

    setRemotePeers(nextRemotePeers)
  }, [])

  const addRemoteProducerTrack = useCallback(
    (
      producerId: string,
      remotePeerId: string,
      kind: MediasoupTypes.MediaKind,
      track: globalThis.MediaStreamTrack,
    ): void => {
      let remotePeerState = remotePeerStreamsRef.current.get(remotePeerId)

      if (!remotePeerState) {
        remotePeerState = {
          stream: new globalThis.MediaStream(),
          producerKinds: new Map<string, MediasoupTypes.MediaKind>(),
        }

        remotePeerStreamsRef.current.set(remotePeerId, remotePeerState)
      }

      const existingTrack = producerTrackRef.current.get(producerId)

      if (existingTrack && existingTrack.id !== track.id) {
        remotePeerState.stream.removeTrack(existingTrack)
      }

      producerPeerIdRef.current.set(producerId, remotePeerId)
      producerTrackRef.current.set(producerId, track)
      remotePeerState.producerKinds.set(producerId, kind)

      const hasTrack = remotePeerState.stream.getTracks().some((streamTrack) => {
        return streamTrack.id === track.id
      })

      if (!hasTrack) {
        remotePeerState.stream.addTrack(track)
      }

      syncRemotePeers()
    },
    [syncRemotePeers],
  )

  const removeConsumedProducer = useCallback(
    (producerId: string, closeConsumer = true): void => {
      const consumer = consumersByProducerIdRef.current.get(producerId)

      if (consumer) {
        consumersByProducerIdRef.current.delete(producerId)

        if (closeConsumer && !consumer.closed) {
          consumer.close()
        }
      }

      consumingProducerIdsRef.current.delete(producerId)
      pendingProducerPeerIdsRef.current.delete(producerId)

      const remotePeerId = producerPeerIdRef.current.get(producerId)

      if (remotePeerId) {
        const remotePeerState = remotePeerStreamsRef.current.get(remotePeerId)
        const track = producerTrackRef.current.get(producerId)

        if (remotePeerState && track) {
          remotePeerState.stream.removeTrack(track)
        }

        if (remotePeerState) {
          remotePeerState.producerKinds.delete(producerId)

          if (remotePeerState.producerKinds.size === 0) {
            remotePeerStreamsRef.current.delete(remotePeerId)
          }
        }
      }

      producerPeerIdRef.current.delete(producerId)
      producerTrackRef.current.delete(producerId)

      setConsumerCount(consumersByProducerIdRef.current.size)
      syncRemotePeers()
    },
    [syncRemotePeers],
  )

  const disconnect = useCallback((): void => {
    clearPendingRequests('WebSocket disconnected')

    const socket = wsRef.current
    wsRef.current = null

    if (socket) {
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null

      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close()
      }
    }

    resetMediaState()
    setPeerId(null)
    setStatus('idle')
    setError('')
  }, [clearPendingRequests, resetMediaState])

  const sendSignalingRequest = useCallback(
    (action: string, data: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const socket = wsRef.current

      if (!socket || socket.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket signaling socket is not open')
      }

      requestCounterRef.current += 1
      const requestId = `req-${requestCounterRef.current}`

      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingRequestsRef.current.delete(requestId)
          reject(new Error(`Signaling request timed out: ${action}`))
        }, 10_000)

        pendingRequestsRef.current.set(requestId, {
          action,
          resolve,
          reject,
          timeout,
        })

        socket.send(
          JSON.stringify({
            event: action,
            requestId,
            data,
          }),
        )
      })
    },
    [],
  )

  const consumeProducer = useCallback(
    async (producerId: string, announcedProducerPeerId?: string): Promise<void> => {
      const device = deviceRef.current
      const recvTransport = recvTransportRef.current

      if (!device || !recvTransport) {
        pendingProducerPeerIdsRef.current.set(producerId, announcedProducerPeerId)
        return
      }

      if (
        consumersByProducerIdRef.current.has(producerId) ||
        consumingProducerIdsRef.current.has(producerId)
      ) {
        return
      }

      consumingProducerIdsRef.current.add(producerId)

      try {
        const consumeData = await sendSignalingRequest('consume', {
          transportId: recvTransport.id,
          producerId,
          rtpCapabilities: device.rtpCapabilities,
        })

        const consumerPayload = consumeData as Record<string, unknown>
        const kindValue = readString(consumerPayload, 'kind')

        if (kindValue !== 'audio' && kindValue !== 'video') {
          throw new Error('Invalid consume response: kind must be audio or video')
        }

        const response: ConsumeResponse = {
          consumerId: readString(consumerPayload, 'consumerId'),
          producerId: readString(consumerPayload, 'producerId'),
          kind: kindValue,
          rtpParameters: consumerPayload.rtpParameters as MediasoupTypes.RtpParameters,
          producerPeerId:
            readOptionalString(consumerPayload, 'producerPeerId') ?? announcedProducerPeerId,
        }

        const consumer = await recvTransport.consume({
          id: response.consumerId,
          producerId: response.producerId,
          kind: response.kind,
          rtpParameters: response.rtpParameters,
        })

        consumersByProducerIdRef.current.set(response.producerId, consumer)

        addRemoteProducerTrack(
          response.producerId,
          response.producerPeerId ?? `unknown-${response.producerId}`,
          response.kind,
          consumer.track,
        )

        setConsumerCount(consumersByProducerIdRef.current.size)

        consumer.on('transportclose', () => {
          removeConsumedProducer(response.producerId, false)
        })

        consumer.on('trackended', () => {
          removeConsumedProducer(response.producerId, false)
        })
      } finally {
        consumingProducerIdsRef.current.delete(producerId)
      }
    },
    [addRemoteProducerTrack, removeConsumedProducer, sendSignalingRequest],
  )

  const parseTransportResponse = useCallback(
    (data: Record<string, unknown>): MediaTransportResponse => {
      const id = readString(data, 'id', readString(data, 'transportId'))

      if (!isRecord(data.iceParameters)) {
        throw new Error('Invalid createTransport response: iceParameters')
      }

      if (!Array.isArray(data.iceCandidates)) {
        throw new Error('Invalid createTransport response: iceCandidates')
      }

      if (!isRecord(data.dtlsParameters)) {
        throw new Error('Invalid createTransport response: dtlsParameters')
      }

      return {
        id,
        iceParameters: data.iceParameters as MediasoupTypes.IceParameters,
        iceCandidates: data.iceCandidates as MediasoupTypes.IceCandidate[],
        dtlsParameters: data.dtlsParameters as MediasoupTypes.DtlsParameters,
      }
    },
    [],
  )

  const connect = useCallback(async (): Promise<void> => {
    disconnect()

    setStatus('connecting')
    setError('')

    try {
      const socket = new WebSocket(wsUrl)
      wsRef.current = socket

      socket.onmessage = (event: MessageEvent<string>) => {
        const parsed = parseJson(event.data)

        if (!isRecord(parsed) || typeof parsed.event !== 'string') {
          return
        }

        if (parsed.event === 'connected') {
          if (isRecord(parsed.data) && typeof parsed.data.peerId === 'string') {
            setPeerId(parsed.data.peerId)
          }

          return
        }

        if (parsed.event === 'ack') {
          if (typeof parsed.requestId !== 'string') {
            return
          }

          const pending = pendingRequestsRef.current.get(parsed.requestId)

          if (!pending) {
            return
          }

          clearTimeout(pending.timeout)
          pendingRequestsRef.current.delete(parsed.requestId)

          if (isRecord(parsed.data)) {
            pending.resolve(parsed.data)
          } else {
            pending.resolve({})
          }

          return
        }

        if (parsed.event === 'error') {
          const errorText =
            typeof parsed.message === 'string' && parsed.message.trim().length > 0
              ? parsed.message
              : 'Signaling request failed'

          if (typeof parsed.requestId === 'string') {
            const pending = pendingRequestsRef.current.get(parsed.requestId)

            if (pending) {
              clearTimeout(pending.timeout)
              pendingRequestsRef.current.delete(parsed.requestId)
              pending.reject(new Error(errorText))
              return
            }
          }

          setError(errorText)
          return
        }

        if (parsed.event === 'newProducer') {
          if (!isRecord(parsed.data) || typeof parsed.data.producerId !== 'string') {
            return
          }

          const announcedProducerPeerId =
            typeof parsed.data.peerId === 'string' ? parsed.data.peerId : undefined

          void consumeProducer(parsed.data.producerId, announcedProducerPeerId).catch(
            (consumeError) => {
              setError(asError(consumeError, 'Failed to consume producer').message)
            },
          )
          return
        }

        if (parsed.event === 'producerClosed') {
          if (!isRecord(parsed.data) || typeof parsed.data.producerId !== 'string') {
            return
          }

          const producerId = parsed.data.producerId
          removeConsumedProducer(producerId)
          return
        }

        if (parsed.event === 'consumerClosed') {
          if (!isRecord(parsed.data) || typeof parsed.data.producerId !== 'string') {
            return
          }

          removeConsumedProducer(parsed.data.producerId)
        }
      }

      socket.onerror = () => {
        setError('WebSocket signaling error')
      }

      socket.onclose = () => {
        clearPendingRequests('WebSocket closed')
        resetMediaState()
        setStatus('idle')
      }

      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => {
          resolve()
        }

        socket.onerror = () => {
          reject(new Error('Could not open signaling WebSocket'))
        }
      })

      const capabilitiesResponse = await fetch(buildHttpUrl(httpBaseUrl, '/rtpCapabilities'))

      if (!capabilitiesResponse.ok) {
        throw new Error(`Failed to fetch RTP capabilities (${capabilitiesResponse.status})`)
      }

      const routerRtpCapabilities =
        (await capabilitiesResponse.json()) as MediasoupTypes.RtpCapabilities

      const iceServersResponse = await fetch(buildHttpUrl(httpBaseUrl, '/iceServers'))

      if (!iceServersResponse.ok) {
        throw new Error(`Failed to fetch ICE servers (${iceServersResponse.status})`)
      }

      const { iceServers } = parseIceServersResponse(await iceServersResponse.json())
      setIceServerCount(iceServers.length)

      const device = new Device()
      await device.load({ routerRtpCapabilities })
      deviceRef.current = device
      setDeviceReady(true)

      const joinData = await sendSignalingRequest('joinRoom', {
        sessionId,
      })

      const existingProducerIds = Array.isArray(joinData.existingProducerIds)
        ? joinData.existingProducerIds.filter((value): value is string => typeof value === 'string')
        : []

      const sendTransportData = parseTransportResponse(
        await sendSignalingRequest('createTransport', {
          direction: 'send',
        }),
      )

      const sendTransport = device.createSendTransport({
        ...sendTransportData,
        iceServers,
      })
      sendTransportRef.current = sendTransport
      setSendTransportId(sendTransport.id)

      sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        void (async () => {
          try {
            await sendSignalingRequest('connectTransport', {
              transportId: sendTransport.id,
              dtlsParameters,
            })
            callback()
          } catch (error) {
            errback(asError(error, 'send transport connect failed'))
          }
        })()
      })

      sendTransport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
        void (async () => {
          try {
            const produceData = await sendSignalingRequest('produce', {
              transportId: sendTransport.id,
              kind,
              rtpParameters,
              appData,
            })

            callback({ id: readString(produceData, 'producerId') })
          } catch (error) {
            errback(asError(error, 'produce failed'))
          }
        })()
      })

      const recvTransportData = parseTransportResponse(
        await sendSignalingRequest('createTransport', {
          direction: 'recv',
        }),
      )

      const recvTransport = device.createRecvTransport({
        ...recvTransportData,
        iceServers,
      })
      recvTransportRef.current = recvTransport
      setRecvTransportId(recvTransport.id)

      recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        void (async () => {
          try {
            await sendSignalingRequest('connectTransport', {
              transportId: recvTransport.id,
              dtlsParameters,
            })
            callback()
          } catch (error) {
            errback(asError(error, 'recv transport connect failed'))
          }
        })()
      })

      if (pendingProducerPeerIdsRef.current.size > 0) {
        const pendingProducers = Array.from(pendingProducerPeerIdsRef.current.entries())

        pendingProducerPeerIdsRef.current.clear()

        for (const [pendingProducerId, announcedProducerPeerId] of pendingProducers) {
          await consumeProducer(pendingProducerId, announcedProducerPeerId)
        }
      }

      for (const producerId of existingProducerIds) {
        await consumeProducer(producerId)
      }

      setStatus('connected')
      setError('')
    } catch (error) {
      disconnect()
      setStatus('failed')
      setError(asError(error, 'Failed to connect mediasoup').message)
      throw error
    }
  }, [
    consumeProducer,
    disconnect,
    httpBaseUrl,
    parseTransportResponse,
    resetMediaState,
    sendSignalingRequest,
    sessionId,
    wsUrl,
  ])

  const startLocalMedia = useCallback(async (): Promise<void> => {
    const socket = wsRef.current

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('Connect to mediasoup first')
    }

    const sendTransport = sendTransportRef.current

    if (!sendTransport) {
      throw new Error('Send transport is not available')
    }

    if (producersRef.current.size > 0) {
      return
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    })

    const audioTrack = stream.getAudioTracks()[0]
    const videoTrack = stream.getVideoTracks()[0]

    if (!audioTrack && !videoTrack) {
      throw new Error('No audio/video tracks available')
    }

    localStreamRef.current = stream
    setLocalStream(stream)

    const registerProducer = (
      kind: MediasoupTypes.MediaKind,
      producer: MediasoupTypes.Producer,
    ): void => {
      producersRef.current.set(kind, producer)
      setProducerIdByKind(kind, producer.id)

      producer.on('transportclose', () => {
        const currentProducer = producersRef.current.get(kind)

        if (currentProducer?.id === producer.id) {
          producersRef.current.delete(kind)
          setProducerIdByKind(kind, null)
        }
      })

      producer.on('trackended', () => {
        const currentProducer = producersRef.current.get(kind)

        if (currentProducer?.id === producer.id) {
          producer.close()
          producersRef.current.delete(kind)
          setProducerIdByKind(kind, null)
        }
      })
    }

    if (audioTrack) {
      const audioProducer = await sendTransport.produce({
        track: audioTrack,
      })

      registerProducer('audio', audioProducer)
    }

    if (videoTrack) {
      const videoProducer = await sendTransport.produce({
        track: videoTrack,
      })

      registerProducer('video', videoProducer)
    }
  }, [setProducerIdByKind])

  const joinSession = useCallback(async (): Promise<void> => {
    const socket = wsRef.current

    if (socket && socket.readyState === WebSocket.OPEN && sendTransportRef.current) {
      await startLocalMedia()
      return
    }

    await connect()
    await startLocalMedia()
  }, [connect, startLocalMedia])

  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  return {
    status,
    error,
    peerId,
    deviceReady,
    sendTransportId,
    recvTransportId,
    localAudioProducerId,
    localVideoProducerId,
    localStream,
    consumerCount,
    iceServerCount,
    remotePeers,
    joinSession,
    connect,
    disconnect,
    startLocalMedia,
  }
}
