import type { DtlsParameters, Router, WebRtcTransport } from 'mediasoup/node/lib/types'

export interface WebRtcTransportParameters {
  id: string
  iceParameters: WebRtcTransport['iceParameters']
  iceCandidates: WebRtcTransport['iceCandidates']
  dtlsParameters: WebRtcTransport['dtlsParameters']
}

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback
  }

  const normalizedValue = value.trim().toLowerCase()

  if (normalizedValue === 'true' || normalizedValue === '1') {
    return true
  }

  if (normalizedValue === 'false' || normalizedValue === '0') {
    return false
  }

  return fallback
}

const getListenIps = (): Array<{ ip: string; announcedIp?: string }> => {
  const ip = process.env.MEDIASOUP_LISTEN_IP ?? '0.0.0.0'
  const announcedIp = process.env.MEDIASOUP_ANNOUNCED_IP

  if (announcedIp) {
    return [{ ip, announcedIp }]
  }

  return [{ ip }]
}

export const getWebRtcTransportParameters = (
  transport: WebRtcTransport,
): WebRtcTransportParameters => {
  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  }
}

export const createWebRtcTransport = async (
  router: Router,
): Promise<{ transport: WebRtcTransport; params: WebRtcTransportParameters }> => {
  const enableUdp = parseBoolean(process.env.MEDIASOUP_ENABLE_UDP, true)
  const enableTcp = parseBoolean(process.env.MEDIASOUP_ENABLE_TCP, true)
  const preferUdp = parseBoolean(process.env.MEDIASOUP_PREFER_UDP, true)

  if (!enableUdp && !enableTcp) {
    throw new Error('Invalid mediasoup transport config: both UDP and TCP are disabled')
  }

  const transport = await router.createWebRtcTransport({
    listenIps: getListenIps(),
    enableUdp,
    enableTcp,
    preferUdp,
  })

  return {
    transport,
    params: getWebRtcTransportParameters(transport),
  }
}

export const connectWebRtcTransport = async (
  transport: WebRtcTransport,
  dtlsParameters: DtlsParameters,
): Promise<void> => {
  await transport.connect({ dtlsParameters })
}
