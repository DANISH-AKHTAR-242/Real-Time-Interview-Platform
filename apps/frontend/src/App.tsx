import { useEffect, useMemo, useState } from 'react'

import { CollabEditor } from './components/CollabEditor'

const defaultSessionId = '00000000-0000-4000-8000-000000000001'
const defaultWsEndpoint =
  (import.meta.env.VITE_WS_URL as string | undefined) ?? 'ws://localhost:3002'

export const App = (): JSX.Element => {
  const [inputSessionId, setInputSessionId] = useState(defaultSessionId)
  const [activeSessionId, setActiveSessionId] = useState(defaultSessionId)
  const [wsEndpoint, setWsEndpoint] = useState(defaultWsEndpoint)
  const [accessToken, setAccessToken] = useState(() => {
    return window.localStorage.getItem('accessToken') ?? ''
  })

  const normalizedSessionId = useMemo(() => {
    return activeSessionId.trim() || defaultSessionId
  }, [activeSessionId])

  const normalizedWsEndpoint = useMemo(() => {
    const value = wsEndpoint.trim()

    if (!value) {
      return defaultWsEndpoint
    }

    return value.replace(/\/$/, '')
  }, [wsEndpoint])

  const normalizedAccessToken = useMemo(() => {
    return accessToken.trim()
  }, [accessToken])

  useEffect(() => {
    if (normalizedAccessToken.length === 0) {
      window.localStorage.removeItem('accessToken')
      return
    }

    window.localStorage.setItem('accessToken', normalizedAccessToken)
  }, [normalizedAccessToken])

  return (
    <main className="app-shell">
      <header className="toolbar">
        <label htmlFor="session-id">Session ID</label>
        <input
          id="session-id"
          value={inputSessionId}
          onChange={(event) => setInputSessionId(event.target.value)}
          placeholder="session-123"
        />
        <button type="button" onClick={() => setActiveSessionId(inputSessionId)}>
          Connect
        </button>

        <label htmlFor="ws-endpoint">WebSocket URL</label>
        <input
          id="ws-endpoint"
          value={wsEndpoint}
          onChange={(event) => setWsEndpoint(event.target.value)}
          placeholder="ws://localhost:3002"
        />

        <label htmlFor="access-token">Access Token</label>
        <input
          id="access-token"
          value={accessToken}
          onChange={(event) => setAccessToken(event.target.value)}
          placeholder="Paste auth-service JWT"
        />
      </header>

      <section className="status-row">
        <span>
          WebSocket: <code>{normalizedWsEndpoint}</code>
        </span>
        <span>
          Params: <code>sessionId={normalizedSessionId}</code>
        </span>
      </section>

      <CollabEditor
        sessionId={normalizedSessionId}
        wsEndpoint={normalizedWsEndpoint}
        accessToken={normalizedAccessToken || undefined}
      />
    </main>
  )
}
