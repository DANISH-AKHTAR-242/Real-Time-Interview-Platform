import jwt, { type JwtPayload } from 'jsonwebtoken'

import { authConfig } from './config.js'

export interface AccessTokenClaims {
  sub: string
  sid: string
  email: string
  exp: number
  iat: number
}

export interface TokenBundle {
  token: string
  ttlSeconds: number
}

const isAccessTokenClaims = (payload: string | JwtPayload): payload is JwtPayload => {
  return typeof payload !== 'string'
}

export const signAccessToken = (claims: {
  userId: string
  sid: string
  email: string
}): TokenBundle => {
  const token = jwt.sign(
    {
      sub: claims.userId,
      sid: claims.sid,
      email: claims.email,
    },
    authConfig.jwtPrivateKey,
    {
      algorithm: 'RS256',
      expiresIn: authConfig.jwtExpiresInSeconds,
    },
  )

  const decoded = jwt.decode(token)

  if (!decoded || !isAccessTokenClaims(decoded) || typeof decoded.exp !== 'number') {
    throw new Error('Failed to decode signed JWT')
  }

  const now = Math.floor(Date.now() / 1000)
  const ttlSeconds = decoded.exp - now

  if (ttlSeconds <= 0) {
    throw new Error('Invalid JWT expiry')
  }

  return { token, ttlSeconds }
}

export const verifyAccessToken = (token: string): AccessTokenClaims => {
  const payload = jwt.verify(token, authConfig.jwtPublicKey, {
    algorithms: ['RS256'],
  })

  if (!isAccessTokenClaims(payload)) {
    throw new Error('Invalid JWT payload')
  }

  const { sub, sid, email, exp, iat } = payload

  if (
    typeof sub !== 'string' ||
    typeof sid !== 'string' ||
    typeof email !== 'string' ||
    typeof exp !== 'number' ||
    typeof iat !== 'number'
  ) {
    throw new Error('Invalid JWT claims')
  }

  return {
    sub,
    sid,
    email,
    exp,
    iat,
  }
}
