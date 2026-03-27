import { verifyAccessToken } from './jwt.js'
import { findSession } from './redis.js'

import type { FastifyReply, FastifyRequest } from 'fastify'

declare module 'fastify' {
  interface FastifyRequest {
    auth?: {
      userId: string
      email: string
      sid: string
    }
  }
}

const extractBearerToken = (authorization: string | undefined): string | null => {
  if (!authorization) {
    return null
  }

  const [scheme, token] = authorization.split(' ')

  if (scheme !== 'Bearer' || !token) {
    return null
  }

  return token
}

export const authPreHandler = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const token = extractBearerToken(request.headers.authorization)

  if (!token) {
    await reply.code(401).send({ message: 'Unauthorized' })
    return
  }

  let claims

  try {
    claims = verifyAccessToken(token)
  } catch {
    await reply.code(401).send({ message: 'Unauthorized' })
    return
  }

  const session = await findSession(claims.sid)

  if (!session || session.userId !== claims.sub) {
    await reply.code(401).send({ message: 'Unauthorized' })
    return
  }

  request.auth = {
    userId: claims.sub,
    email: claims.email,
    sid: claims.sid,
  }
}
