import jwt, { type JwtPayload } from 'jsonwebtoken'

import type { IncomingMessage } from 'node:http'

const getRequiredEnv = (name: string): string => {
  const value = process.env[name]

  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

const normalizePem = (value: string): string => {
  if (value.includes('-----BEGIN')) {
    return value
  }

  return value.replace(/\\n/g, '\n')
}

const JWT_PUBLIC_KEY = normalizePem(getRequiredEnv('JWT_PUBLIC_KEY'))
const SESSION_SERVICE_URL = process.env.SESSION_SERVICE_URL?.trim()

interface JwtClaims {
  sub: string
}

interface AuthQueryParams {
  token: string
  sessionId: string
}

export interface AuthenticatedUpgrade {
  userId: string
  sessionId: string
}

const toAuthQueryParams = (requestUrl: string | undefined): AuthQueryParams | null => {
  if (!requestUrl) {
    return null
  }

  const url = new URL(requestUrl, 'ws://localhost')
  const token = url.searchParams.get('token')
  const sessionId = url.searchParams.get('sessionId')

  if (!token || !sessionId) {
    return null
  }

  return {
    token,
    sessionId,
  }
}

const parseClaims = (payload: string | JwtPayload): JwtClaims => {
  if (typeof payload === 'string' || typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new Error('Invalid JWT payload')
  }

  return {
    sub: payload.sub,
  }
}

const verifyAccessToken = (token: string): JwtClaims => {
  const payload = jwt.verify(token, JWT_PUBLIC_KEY, {
    algorithms: ['RS256'],
  })

  return parseClaims(payload)
}

const hasMockSessionAccess = (userId: string, sessionId: string): boolean => {
  return sessionId.startsWith(`${userId}:`)
}

const hasSessionServiceAccess = async (userId: string, sessionId: string): Promise<boolean> => {
  if (!SESSION_SERVICE_URL) {
    return hasMockSessionAccess(userId, sessionId)
  }

  const endpoint = `${SESSION_SERVICE_URL.replace(/\/$/, '')}/sessions/${encodeURIComponent(sessionId)}`
  const response = await fetch(endpoint)

  if (response.status === 404) {
    return false
  }

  if (!response.ok) {
    throw new Error(`Session-service authorization check failed with status ${response.status}`)
  }

  const body = (await response.json()) as {
    session?: {
      candidateId?: string
      interviewerId?: string
    }
  }

  const session = body.session

  if (!session) {
    return false
  }

  return session.candidateId === userId || session.interviewerId === userId
}

export const authenticateUpgradeRequest = async (
  request: IncomingMessage,
): Promise<AuthenticatedUpgrade> => {
  const query = toAuthQueryParams(request.url)

  if (!query) {
    throw new Error('Missing token or sessionId query parameter')
  }

  const claims = verifyAccessToken(query.token)
  const hasAccess = await hasSessionServiceAccess(claims.sub, query.sessionId)

  if (!hasAccess) {
    throw new Error('Forbidden: user is not authorized for this session')
  }

  return {
    userId: claims.sub,
    sessionId: query.sessionId,
  }
}
