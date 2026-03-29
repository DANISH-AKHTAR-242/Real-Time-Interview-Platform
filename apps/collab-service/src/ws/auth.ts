import jwt, { type JwtPayload } from 'jsonwebtoken'

import { collabConfig } from './config.js'

import type { IncomingMessage } from 'node:http'

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

export class UpgradeAuthError extends Error {
  statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'UpgradeAuthError'
    this.statusCode = statusCode
  }
}

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

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
  const payload = jwt.verify(token, collabConfig.jwtPublicKey, {
    algorithms: ['RS256'],
  })

  return parseClaims(payload)
}

const hasMockSessionAccess = (userId: string, sessionId: string): boolean => {
  return sessionId.startsWith(`${userId}:`)
}

const hasSessionServiceAccess = async (userId: string, sessionId: string): Promise<boolean> => {
  if (!collabConfig.sessionServiceUrl) {
    if (!collabConfig.allowMockSessionAccess) {
      throw new UpgradeAuthError(503, 'Session authorization provider is not configured')
    }

    return hasMockSessionAccess(userId, sessionId)
  }

  const endpoint = `${collabConfig.sessionServiceUrl}/sessions/${encodeURIComponent(sessionId)}`

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, collabConfig.sessionServiceTimeoutMs)

  let response: Response

  try {
    response = await fetch(endpoint, {
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new UpgradeAuthError(503, 'Session-service authorization check timed out')
    }

    throw new UpgradeAuthError(503, 'Session-service authorization check failed')
  } finally {
    clearTimeout(timeout)
  }

  if (response.status === 404) {
    return false
  }

  if (!response.ok) {
    throw new UpgradeAuthError(503, `Session-service returned status ${response.status}`)
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
    throw new UpgradeAuthError(401, 'Missing token or sessionId query parameter')
  }

  if (collabConfig.sessionServiceUrl && !isUuid(query.sessionId)) {
    throw new UpgradeAuthError(400, 'sessionId must be a valid UUID')
  }

  if (
    !collabConfig.sessionServiceUrl &&
    !isUuid(query.sessionId) &&
    !collabConfig.allowMockSessionAccess
  ) {
    throw new UpgradeAuthError(400, 'sessionId must be a valid UUID')
  }

  let claims: JwtClaims

  try {
    claims = verifyAccessToken(query.token)
  } catch {
    throw new UpgradeAuthError(401, 'Invalid access token')
  }

  const hasAccess = await hasSessionServiceAccess(claims.sub, query.sessionId)

  if (!hasAccess) {
    throw new UpgradeAuthError(403, 'Forbidden: user is not authorized for this session')
  }

  return {
    userId: claims.sub,
    sessionId: query.sessionId,
  }
}
