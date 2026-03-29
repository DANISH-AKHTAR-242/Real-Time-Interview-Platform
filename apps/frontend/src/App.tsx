import { useMemo, useState } from 'react'

import { CollabEditor } from './components/CollabEditor'

const defaultSessionId = 'session-123'

export const App = (): JSX.Element => {
  const [inputSessionId, setInputSessionId] = useState(defaultSessionId)
  const [activeSessionId, setActiveSessionId] = useState(defaultSessionId)

  const normalizedSessionId = useMemo(() => {
    return activeSessionId.trim() || defaultSessionId
  }, [activeSessionId])

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
      </header>

      <section className="status-row">
        <span>
          WebSocket: <code>ws://localhost:3002/{normalizedSessionId}</code>
        </span>
      </section>

      <CollabEditor sessionId={normalizedSessionId} />
    </main>
  )
}
