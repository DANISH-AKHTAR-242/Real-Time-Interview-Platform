import { useEffect, useMemo, useRef, useState } from 'react'

import { type RemotePeerMedia, useMediasoupConnection } from '../hooks/useMediasoupConnection'

interface MediaSfuPanelProps {
  sessionId: string
  autoJoinToken?: number
}

const defaultMediaHttpUrl =
  (import.meta.env.VITE_MEDIA_HTTP_URL as string | undefined) ?? 'http://localhost:3004'
const defaultMediaWsUrl =
  (import.meta.env.VITE_MEDIA_WS_URL as string | undefined) ?? 'ws://localhost:3004/ws'

const LocalPeerCard = ({ stream }: { stream: MediaStream | null }): JSX.Element => {
  const localVideoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const localVideoElement = localVideoRef.current

    if (!localVideoElement) {
      return
    }

    if (stream && localVideoElement.srcObject !== stream) {
      localVideoElement.srcObject = stream
    }

    if (!stream) {
      localVideoElement.srcObject = null
    }

    return () => {
      if (localVideoElement.srcObject === stream) {
        localVideoElement.srcObject = null
      }
    }
  }, [stream])

  return (
    <article className="remote-peer-card">
      <div className="remote-peer-meta">
        <span className="remote-peer-id">local</span>
      </div>

      {stream ? (
        <video
          ref={localVideoRef}
          className="remote-peer-video"
          autoPlay
          playsInline
          muted
          controls
        />
      ) : (
        <p className="remote-peer-empty">Camera preview will appear after joining.</p>
      )}
    </article>
  )
}

const RemotePeerCard = ({ remotePeer }: { remotePeer: RemotePeerMedia }): JSX.Element => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const hasVideo = remotePeer.videoProducerCount > 0
  const hasAudio = remotePeer.audioProducerCount > 0

  useEffect(() => {
    const videoElement = videoRef.current
    const audioElement = audioRef.current

    if (hasVideo && videoElement && videoElement.srcObject !== remotePeer.stream) {
      videoElement.srcObject = remotePeer.stream
    }

    if (!hasVideo && hasAudio && audioElement && audioElement.srcObject !== remotePeer.stream) {
      audioElement.srcObject = remotePeer.stream
    }

    return () => {
      if (videoElement && videoElement.srcObject === remotePeer.stream) {
        videoElement.srcObject = null
      }

      if (audioElement && audioElement.srcObject === remotePeer.stream) {
        audioElement.srcObject = null
      }
    }
  }, [hasAudio, hasVideo, remotePeer.stream])

  return (
    <article className="remote-peer-card">
      <div className="remote-peer-meta">
        <span className="remote-peer-id">peer: {remotePeer.peerId}</span>
        <span>
          tracks: a={remotePeer.audioProducerCount} v={remotePeer.videoProducerCount}
        </span>
      </div>

      {hasVideo ? (
        <video ref={videoRef} className="remote-peer-video" autoPlay playsInline controls />
      ) : null}

      {!hasVideo && hasAudio ? <audio ref={audioRef} autoPlay controls /> : null}

      {!hasVideo && !hasAudio ? (
        <p className="remote-peer-empty">No active remote tracks for this peer.</p>
      ) : null}
    </article>
  )
}

export const MediaSfuPanel = ({ sessionId, autoJoinToken }: MediaSfuPanelProps): JSX.Element => {
  const [httpBaseUrl, setHttpBaseUrl] = useState(defaultMediaHttpUrl)
  const [wsUrl, setWsUrl] = useState(defaultMediaWsUrl)
  const lastAutoJoinTokenRef = useRef<number | undefined>(undefined)

  const normalizedHttpBaseUrl = useMemo(() => {
    const value = httpBaseUrl.trim()

    if (!value) {
      return defaultMediaHttpUrl
    }

    return value.replace(/\/$/, '')
  }, [httpBaseUrl])

  const normalizedWsUrl = useMemo(() => {
    const value = wsUrl.trim()

    if (!value) {
      return defaultMediaWsUrl
    }

    return value
  }, [wsUrl])

  const mediaConnection = useMediasoupConnection({
    sessionId,
    httpBaseUrl: normalizedHttpBaseUrl,
    wsUrl: normalizedWsUrl,
  })
  const joinSession = mediaConnection.joinSession

  const busy = mediaConnection.status === 'connecting'

  useEffect(() => {
    if (autoJoinToken === undefined) {
      return
    }

    if (lastAutoJoinTokenRef.current === autoJoinToken) {
      return
    }

    lastAutoJoinTokenRef.current = autoJoinToken
    void joinSession()
  }, [autoJoinToken, joinSession])

  return (
    <section className="media-panel">
      <div className="media-panel-header">
        <h2>Mediasoup Browser Link</h2>
        <span className={`media-status media-status-${mediaConnection.status}`}>
          {mediaConnection.status}
        </span>
      </div>

      <div className="media-panel-form">
        <label htmlFor="media-http-url">Media HTTP URL</label>
        <input
          id="media-http-url"
          value={httpBaseUrl}
          onChange={(event) => setHttpBaseUrl(event.target.value)}
          placeholder="http://localhost:3004"
        />

        <label htmlFor="media-ws-url">Media WebSocket URL</label>
        <input
          id="media-ws-url"
          value={wsUrl}
          onChange={(event) => setWsUrl(event.target.value)}
          placeholder="ws://localhost:3004/ws"
        />

        <label htmlFor="media-session-id">Session ID</label>
        <input id="media-session-id" value={sessionId} readOnly />
      </div>

      <div className="media-panel-actions">
        <button type="button" onClick={() => void joinSession()} disabled={busy}>
          {busy ? 'Joining...' : 'Join Session'}
        </button>

        <button type="button" onClick={mediaConnection.disconnect}>
          Leave Session
        </button>
      </div>

      <div className="media-panel-meta">
        <span>peerId: {mediaConnection.peerId ?? 'n/a'}</span>
        <span>deviceLoaded: {mediaConnection.deviceReady ? 'yes' : 'no'}</span>
        <span>iceServers: {mediaConnection.iceServerCount}</span>
        <span>sendTransport: {mediaConnection.sendTransportId ?? 'n/a'}</span>
        <span>recvTransport: {mediaConnection.recvTransportId ?? 'n/a'}</span>
        <span>audioProducer: {mediaConnection.localAudioProducerId ?? 'n/a'}</span>
        <span>videoProducer: {mediaConnection.localVideoProducerId ?? 'n/a'}</span>
        <span>consumers: {mediaConnection.consumerCount}</span>
        <span>remotePeers: {mediaConnection.remotePeers.length}</span>
      </div>

      <div className="remote-media-section">
        <h3>Video Grid</h3>

        <div className="remote-media-grid">
          <LocalPeerCard stream={mediaConnection.localStream} />

          {mediaConnection.remotePeers.map((remotePeer) => {
            return <RemotePeerCard key={remotePeer.peerId} remotePeer={remotePeer} />
          })}
        </div>

        {mediaConnection.remotePeers.length === 0 ? (
          <p className="remote-peer-empty">Waiting for other participants to join.</p>
        ) : null}
      </div>

      {mediaConnection.error ? <p className="media-error">{mediaConnection.error}</p> : null}
    </section>
  )
}
