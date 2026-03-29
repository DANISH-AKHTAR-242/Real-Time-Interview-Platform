import type { FastifyRequest } from 'fastify'

export interface RequestIdentity {
  userId: string | null
  ipAddress: string
  ownerKey: string
  rateLimitUserKey: string | null
  rateLimitIpKey: string
}

const USER_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,64}$/

const getHeaderValue = (value: string | string[] | undefined): string | null => {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
    return value[0]
  }

  return null
}

const normalizeIpAddress = (rawIpAddress: string): string => {
  const normalized = rawIpAddress.trim()

  if (normalized.length === 0 || normalized.length > 128) {
    return 'unknown-ip'
  }

  return normalized
}

const parseUserIdHeader = (request: FastifyRequest): string | null => {
  const headerValue = getHeaderValue(request.headers['x-user-id'])

  if (!headerValue) {
    return null
  }

  const normalized = headerValue.trim()

  if (!USER_ID_PATTERN.test(normalized)) {
    return null
  }

  return normalized
}

export const getRequestIdentity = (request: FastifyRequest): RequestIdentity => {
  const userId = parseUserIdHeader(request)
  const ipAddress = normalizeIpAddress(request.ip)

  return {
    userId,
    ipAddress,
    ownerKey: userId ? `user:${userId}` : `anon-ip:${ipAddress}`,
    rateLimitUserKey: userId ? `user:${userId}` : null,
    rateLimitIpKey: `ip:${ipAddress}`,
  }
}
