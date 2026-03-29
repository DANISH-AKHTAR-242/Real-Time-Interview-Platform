import { redisConnection } from '../queue/redis.js'

import { type RequestIdentity } from './identity.js'
import { executionSecurityPolicy } from './policy.js'

export type RateLimitScope = 'user' | 'anonymous' | 'ip'

export interface RateLimitDecision {
  allowed: boolean
  scope: RateLimitScope
  retryAfterSeconds: number
}

const buildRateLimitKey = (scope: RateLimitScope, bucketKey: string, slot: number): string => {
  return `execution-service:rate-limit:${scope}:${bucketKey}:${slot}`
}

const checkFixedWindowLimit = async (
  scope: RateLimitScope,
  bucketKey: string,
  maxRequests: number,
): Promise<RateLimitDecision> => {
  const now = Date.now()
  const windowMs = executionSecurityPolicy.rateLimitWindowMs
  const slot = Math.floor(now / windowMs)
  const key = buildRateLimitKey(scope, bucketKey, slot)

  const requestCount = await redisConnection.incr(key)

  if (requestCount === 1) {
    await redisConnection.pexpire(key, windowMs + 1_000)
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now % windowMs)) / 1_000))

  return {
    allowed: requestCount <= maxRequests,
    scope,
    retryAfterSeconds,
  }
}

export const enforceExecutionRateLimit = async (
  identity: RequestIdentity,
): Promise<RateLimitDecision> => {
  if (identity.rateLimitUserKey) {
    const perUserDecision = await checkFixedWindowLimit(
      'user',
      identity.rateLimitUserKey,
      executionSecurityPolicy.userRequestsPerWindow,
    )

    if (!perUserDecision.allowed) {
      return perUserDecision
    }

    const perIpDecision = await checkFixedWindowLimit(
      'ip',
      identity.rateLimitIpKey,
      executionSecurityPolicy.ipRequestsPerWindow,
    )

    if (!perIpDecision.allowed) {
      return perIpDecision
    }

    return {
      allowed: true,
      scope: 'user',
      retryAfterSeconds: 0,
    }
  }

  const anonymousDecision = await checkFixedWindowLimit(
    'anonymous',
    identity.rateLimitIpKey,
    executionSecurityPolicy.anonymousRequestsPerWindow,
  )

  if (!anonymousDecision.allowed) {
    return anonymousDecision
  }

  return {
    allowed: true,
    scope: 'anonymous',
    retryAfterSeconds: 0,
  }
}
