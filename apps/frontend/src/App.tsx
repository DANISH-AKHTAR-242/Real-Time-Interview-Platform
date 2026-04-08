import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  enqueueExecution,
  type ExecutionLanguage,
  type ExecutionResultResponse,
  waitForExecutionResult,
} from './api/execution'

import { CollabEditor } from './components/CollabEditor'
import { MediaSfuPanel } from './components/MediaSfuPanel'

const defaultSessionId = '00000000-0000-4000-8000-000000000001'
const defaultWsEndpoint =
  (import.meta.env.VITE_WS_URL as string | undefined) ?? 'ws://localhost:3002'
const defaultExecutionApiUrl = (import.meta.env.VITE_EXECUTION_API_URL as string | undefined) ?? ''

const languageTemplates: Record<ExecutionLanguage, string> = {
  javascript: `console.log('Hello from JavaScript')`,
  python: `print('Hello from Python')`,
}

type RunState = 'idle' | 'submitting' | 'running' | 'completed' | 'failed'

export const App = (): JSX.Element => {
  const [inputSessionId, setInputSessionId] = useState(defaultSessionId)
  const [activeSessionId, setActiveSessionId] = useState(defaultSessionId)
  const [joinRequestToken, setJoinRequestToken] = useState(0)
  const [wsEndpoint, setWsEndpoint] = useState(defaultWsEndpoint)
  const [language, setLanguage] = useState<ExecutionLanguage>('javascript')
  const [code, setCode] = useState(languageTemplates.javascript)
  const [runState, setRunState] = useState<RunState>('idle')
  const [jobId, setJobId] = useState<string | null>(null)
  const [stdout, setStdout] = useState('')
  const [stderr, setStderr] = useState('')
  const [executionError, setExecutionError] = useState('')
  const [accessToken, setAccessToken] = useState(() => {
    return window.localStorage.getItem('accessToken') ?? ''
  })
  const pollingAbortControllerRef = useRef<AbortController | null>(null)

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

  const normalizedExecutionApiUrl = useMemo(() => {
    return defaultExecutionApiUrl.trim().replace(/\/$/, '')
  }, [])

  const runStatusLabel = useMemo(() => {
    if (runState === 'submitting') {
      return 'Submitting job...'
    }

    if (runState === 'running') {
      return 'Running...'
    }

    if (runState === 'completed') {
      return 'Completed'
    }

    if (runState === 'failed') {
      return 'Failed'
    }

    return 'Idle'
  }, [runState])

  const isRunning = runState === 'submitting' || runState === 'running'

  const applyExecutionResult = useCallback((result: ExecutionResultResponse): void => {
    setStdout(result.result?.stdout ?? '')
    setStderr(result.result?.stderr ?? '')

    const errorParts = [result.result?.error ?? '', result.error ?? ''].filter(
      (value) => value.trim().length > 0,
    )

    setExecutionError(errorParts.join('\n'))
  }, [])

  const handleCodeChange = useCallback((nextCode: string): void => {
    setCode(nextCode)
  }, [])

  const handleLanguageChange = useCallback((nextLanguage: ExecutionLanguage): void => {
    setLanguage(nextLanguage)
  }, [])

  const handleJoinSession = useCallback((): void => {
    setActiveSessionId(inputSessionId)
    setJoinRequestToken((currentToken) => currentToken + 1)
  }, [inputSessionId])

  const handleRunCode = useCallback(async (): Promise<void> => {
    if (code.trim().length === 0) {
      setRunState('failed')
      setExecutionError('Code cannot be empty')
      setStdout('')
      setStderr('')
      return
    }

    pollingAbortControllerRef.current?.abort()

    const abortController = new AbortController()
    pollingAbortControllerRef.current = abortController

    setRunState('submitting')
    setJobId(null)
    setStdout('')
    setStderr('')
    setExecutionError('')

    try {
      const queuedJob = await enqueueExecution(
        normalizedExecutionApiUrl,
        {
          code,
          language,
        },
        abortController.signal,
      )

      setJobId(queuedJob.jobId)
      setRunState('running')

      const finalResult = await waitForExecutionResult(
        normalizedExecutionApiUrl,
        queuedJob.jobId,
        abortController.signal,
      )

      applyExecutionResult(finalResult)
      setRunState(finalResult.status === 'completed' ? 'completed' : 'failed')
    } catch (error) {
      if (abortController.signal.aborted) {
        return
      }

      const message = error instanceof Error ? error.message : 'Execution request failed'

      setRunState('failed')
      setExecutionError(message)
    } finally {
      if (pollingAbortControllerRef.current === abortController) {
        pollingAbortControllerRef.current = null
      }
    }
  }, [applyExecutionResult, code, language, normalizedExecutionApiUrl])

  useEffect(() => {
    if (normalizedAccessToken.length === 0) {
      window.localStorage.removeItem('accessToken')
      return
    }

    window.localStorage.setItem('accessToken', normalizedAccessToken)
  }, [normalizedAccessToken])

  useEffect(() => {
    return () => {
      pollingAbortControllerRef.current?.abort()
    }
  }, [])

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
        <button type="button" onClick={handleJoinSession}>
          Join Session
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

        <label htmlFor="language">Language</label>
        <select
          id="language"
          value={language}
          onChange={(event) => handleLanguageChange(event.target.value as ExecutionLanguage)}
        >
          <option value="javascript">JavaScript</option>
          <option value="python">Python</option>
        </select>

        <button type="button" onClick={() => void handleRunCode()} disabled={isRunning}>
          {isRunning ? 'Running...' : 'Run Code'}
        </button>
      </header>

      <section className="status-row">
        <span>
          WebSocket: <code>{normalizedWsEndpoint}</code>
        </span>
        <span>
          Params: <code>sessionId={normalizedSessionId}</code>
        </span>
        <span>
          Execution API: <code>{normalizedExecutionApiUrl || 'vite-proxy'}</code>
        </span>
      </section>

      <MediaSfuPanel sessionId={normalizedSessionId} autoJoinToken={joinRequestToken} />

      <section className="editor-output-layout">
        <CollabEditor
          sessionId={normalizedSessionId}
          wsEndpoint={normalizedWsEndpoint}
          accessToken={normalizedAccessToken || undefined}
          language={language}
          initialCode={languageTemplates[language]}
          onCodeChange={handleCodeChange}
        />

        <section className="run-panel">
          <div className="run-meta">
            <span className={`run-state run-state-${runState}`}>{runStatusLabel}</span>
            <span>Job ID: {jobId ?? 'N/A'}</span>
          </div>

          <div className="output-grid">
            <article className="output-block">
              <h2>stdout</h2>
              <pre>{stdout || '(empty)'}</pre>
            </article>

            <article className="output-block">
              <h2>stderr</h2>
              <pre>{stderr || '(empty)'}</pre>
            </article>

            <article className="output-block">
              <h2>errors</h2>
              <pre>{executionError || '(none)'}</pre>
            </article>
          </div>
        </section>
      </section>
    </main>
  )
}
