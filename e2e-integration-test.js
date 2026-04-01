import axios from 'axios'
import WebSocket from 'ws'
import { randomUUID } from 'node:crypto'

const AUTH_BASE_URL = process.env.AUTH_BASE_URL || 'http://localhost:3001'
const COLLAB_BASE_URL = process.env.COLLAB_BASE_URL || 'ws://localhost:3002'
const SESSION_BASE_URL = process.env.SESSION_BASE_URL || 'http://localhost:3003'
const EXECUTION_BASE_URL = process.env.EXECUTION_BASE_URL || 'http://localhost:3004'

const POLL_INTERVAL_MS = 500
const POLL_TIMEOUT_MS = 30_000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message)
  }
}

const logStepStart = (label) => {
  console.log(`\n[STEP] ${label}`)
}

const logStepSuccess = (label, detail) => {
  console.log(`[PASS] ${label}${detail ? ` -> ${detail}` : ''}`)
}

const normalizeAxiosError = (error) => {
  if (error.response) {
    return `${error.message} (status=${error.response.status}, body=${JSON.stringify(error.response.data)})`
  }

  return error.message
}

const registerUser = async (client, email, password) => {
  const response = await client.post('/register', { email, password })

  assert(response.status === 201, `Expected 201 from /register, got ${response.status}`)
  assert(response.data && typeof response.data.token === 'string', 'Register response missing token')
  assert(response.data.user && typeof response.data.user.id === 'string', 'Register response missing user.id')

  return response.data
}

const loginUser = async (client, email, password) => {
  const response = await client.post('/login', { email, password })

  assert(response.status === 200, `Expected 200 from /login, got ${response.status}`)
  assert(response.data && typeof response.data.token === 'string', 'Login response missing token')
  assert(response.data.user && typeof response.data.user.id === 'string', 'Login response missing user.id')

  return response.data
}

const createSession = async (client, token, candidateId, interviewerId) => {
  const response = await client.post(
    '/sessions',
    {
      candidateId,
      interviewerId,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  )

  assert(response.status === 201, `Expected 201 from /sessions, got ${response.status}`)
  assert(response.data && response.data.session && typeof response.data.session.id === 'string', 'Session response missing session.id')

  return response.data.session.id
}

const verifyWebSocketConnection = async (sessionId, token) => {
  await new Promise((resolve, reject) => {
    const wsUrl = new URL(COLLAB_BASE_URL)
    wsUrl.searchParams.set('sessionId', sessionId)
    wsUrl.searchParams.set('token', token)

    const socket = new WebSocket(wsUrl.toString())
    let settled = false

    const settle = (fn) => (value) => {
      if (settled) {
        return
      }

      settled = true
      fn(value)
    }

    const resolveOnce = settle(resolve)
    const rejectOnce = settle(reject)

    const connectTimeout = setTimeout(() => {
      rejectOnce(new Error('WebSocket connection timed out before opening'))
    }, 10_000)

    socket.on('open', () => {
      clearTimeout(connectTimeout)

      const stabilityTimer = setTimeout(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.close(1000, 'E2E verification completed')
          resolveOnce(undefined)
          return
        }

        rejectOnce(new Error('WebSocket did not remain open during verification window'))
      }, 2_000)

      socket.once('close', (code, reason) => {
        const reasonText = Buffer.isBuffer(reason) ? reason.toString() : String(reason || '')
        clearTimeout(stabilityTimer)
        rejectOnce(new Error(`WebSocket closed unexpectedly after open (code=${code}, reason=${reasonText})`))
      })
    })

    socket.once('error', (error) => {
      clearTimeout(connectTimeout)
      rejectOnce(error)
    })

    socket.once('close', (code, reason) => {
      if (settled) {
        return
      }

      const reasonText = Buffer.isBuffer(reason) ? reason.toString() : String(reason || '')
      clearTimeout(connectTimeout)
      rejectOnce(new Error(`WebSocket closed before open verification (code=${code}, reason=${reasonText})`))
    })
  })
}

const submitExecutionJob = async (client, userId, payload) => {
  const response = await client.post('/execute', payload, {
    headers: {
      'x-user-id': userId,
    },
  })

  assert(response.status === 202, `Expected 202 from /execute, got ${response.status}`)
  assert(response.data && typeof response.data.jobId === 'string', 'Execute response missing jobId')

  return response.data.jobId
}

const pollForJobResult = async (client, userId, jobId) => {
  const deadline = Date.now() + POLL_TIMEOUT_MS

  while (Date.now() < deadline) {
    const response = await client.get(`/result/${encodeURIComponent(jobId)}`, {
      headers: {
        'x-user-id': userId,
      },
    })

    assert(response.status === 200, `Expected 200 from /result/${jobId}, got ${response.status}`)

    const payload = response.data
    assert(payload && typeof payload.status === 'string', 'Result response missing status')

    if (payload.status === 'completed' || payload.status === 'failed') {
      return payload
    }

    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error(`Timed out waiting for job ${jobId} completion after ${POLL_TIMEOUT_MS}ms`)
}

const run = async () => {
  const authClient = axios.create({
    baseURL: AUTH_BASE_URL,
    timeout: 10_000,
    validateStatus: () => true,
  })

  const sessionClient = axios.create({
    baseURL: SESSION_BASE_URL,
    timeout: 10_000,
    validateStatus: () => true,
  })

  const executionClient = axios.create({
    baseURL: EXECUTION_BASE_URL,
    timeout: 10_000,
    validateStatus: () => true,
  })

  const email = `e2e.${Date.now()}.${Math.floor(Math.random() * 100000)}@example.com`
  const password = 'E2EPassword!123'

  logStepStart('Auth Service: register user')
  const registration = await registerUser(authClient, email, password)
  logStepSuccess('Auth Service: register user', `userId=${registration.user.id}`)

  logStepStart('Auth Service: login user')
  const login = await loginUser(authClient, email, password)
  const jwt = login.token
  const userId = login.user.id
  logStepSuccess('Auth Service: login user', `jwtLength=${jwt.length}`)

  logStepStart('Session Service: create interview session')
  const sessionId = await createSession(sessionClient, jwt, userId, randomUUID())
  logStepSuccess('Session Service: create interview session', `sessionId=${sessionId}`)

  logStepStart('Collab Service: WebSocket auth handshake')
  await verifyWebSocketConnection(sessionId, jwt)
  logStepSuccess('Collab Service: WebSocket auth handshake', 'connection accepted and remained stable')

  logStepStart('Execution Service happy path: run JavaScript job')
  const happyJobId = await submitExecutionJob(executionClient, userId, {
    language: 'javascript',
    code: 'console.log("E2E Test Success")',
  })
  const happyResult = await pollForJobResult(executionClient, userId, happyJobId)

  assert(happyResult.status === 'completed', `Happy path expected completed, got ${happyResult.status}`)
  assert(happyResult.result && typeof happyResult.result.stdout === 'string', 'Happy path missing stdout')
  assert(
    happyResult.result.stdout.trim() === 'E2E Test Success',
    `Happy path stdout mismatch. Expected "E2E Test Success", got ${JSON.stringify(happyResult.result.stdout)}`,
  )
  logStepSuccess('Execution Service happy path: run JavaScript job', `jobId=${happyJobId}`)

  logStepStart('Execution Service security path: run malicious Python timeout job')
  const securityJobId = await submitExecutionJob(executionClient, userId, {
    language: 'python',
    code: 'while True:\n    pass',
  })
  const securityResult = await pollForJobResult(executionClient, userId, securityJobId)

  const isFailedStatus = securityResult.status === 'failed'
  const timeoutError =
    securityResult.status === 'completed' &&
    securityResult.result &&
    typeof securityResult.result.error === 'string' &&
    securityResult.result.error.includes('TIMEOUT')

  assert(
    isFailedStatus || timeoutError,
    `Security path did not fail/timeout as expected. Got: ${JSON.stringify(securityResult)}`,
  )

  logStepSuccess(
    'Execution Service security path: run malicious Python timeout job',
    `jobId=${securityJobId}, status=${securityResult.status}`,
  )

  console.log('\n✅ End-to-end integration test completed successfully.')
}

;(async () => {
  try {
    await run()
  } catch (error) {
    const message = error instanceof Error ? normalizeAxiosError(error) : String(error)
    console.error(`\n❌ Integration test failed: ${message}`)
    process.exit(1)
  }
})()
