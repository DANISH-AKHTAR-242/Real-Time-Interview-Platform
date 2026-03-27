import { randomUUID } from 'node:crypto'

import { getYDoc, type WSSharedDoc } from '@y/websocket-server/utils'
import { Redis } from 'ioredis'
import { applyUpdate } from 'yjs'

const CHANNEL_PREFIX = 'collab:yjs:session:'
const CHANNEL_PATTERN = `${CHANNEL_PREFIX}*`
const REDIS_UPDATE_ORIGIN = Symbol('redis-pubsub-origin')
const INSTANCE_ID = randomUUID()

interface RedisUpdateMessage {
  instanceId: string
  update: string
}

interface SessionBinding {
  doc: WSSharedDoc
  onUpdate: (update: Uint8Array, origin: unknown) => void
}

const getRequiredEnv = (name: string): string => {
  const value = process.env[name]

  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

const redisUrl = getRequiredEnv('REDIS_URL')

const publisher = new Redis(redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
})

const subscriber = new Redis(redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
})

const bindings = new Map<string, SessionBinding>()
let initialized = false

const sessionChannel = (sessionId: string): string => `${CHANNEL_PREFIX}${sessionId}`

const parseSessionIdFromChannel = (channel: string): string | null => {
  if (!channel.startsWith(CHANNEL_PREFIX)) {
    return null
  }

  const sessionId = channel.slice(CHANNEL_PREFIX.length)

  return sessionId.length > 0 ? sessionId : null
}

const parseRedisMessage = (message: string): RedisUpdateMessage | null => {
  try {
    const parsed = JSON.parse(message) as Partial<RedisUpdateMessage>

    if (typeof parsed.instanceId !== 'string' || typeof parsed.update !== 'string') {
      return null
    }

    return {
      instanceId: parsed.instanceId,
      update: parsed.update,
    }
  } catch {
    return null
  }
}

const publishUpdate = async (sessionId: string, update: Uint8Array): Promise<void> => {
  const payload: RedisUpdateMessage = {
    instanceId: INSTANCE_ID,
    update: Buffer.from(update).toString('base64'),
  }

  await publisher.publish(sessionChannel(sessionId), JSON.stringify(payload))
}

const registerSessionBinding = (sessionId: string): SessionBinding => {
  const existing = bindings.get(sessionId)

  if (existing) {
    return existing
  }

  const doc = getYDoc(sessionId)

  const onUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === REDIS_UPDATE_ORIGIN) {
      return
    }

    void publishUpdate(sessionId, update).catch((error) => {
      console.error(`[collab-service] failed to publish update session=${sessionId}`, error)
    })
  }

  doc.on('update', onUpdate)

  const binding: SessionBinding = {
    doc,
    onUpdate,
  }

  bindings.set(sessionId, binding)
  return binding
}

const handleRedisMessage = (channel: string, message: string): void => {
  const sessionId = parseSessionIdFromChannel(channel)

  if (!sessionId) {
    return
  }

  const parsed = parseRedisMessage(message)

  if (!parsed || parsed.instanceId === INSTANCE_ID) {
    return
  }

  const binding = registerSessionBinding(sessionId)

  try {
    const update = Buffer.from(parsed.update, 'base64')
    applyUpdate(binding.doc, new Uint8Array(update), REDIS_UPDATE_ORIGIN)
  } catch (error) {
    console.error(`[collab-service] failed to apply redis update session=${sessionId}`, error)
  }
}

export const initializePubSub = async (): Promise<void> => {
  if (initialized) {
    return
  }

  await Promise.all([publisher.connect(), subscriber.connect()])

  subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
    handleRedisMessage(channel, message)
  })

  await subscriber.psubscribe(CHANNEL_PATTERN)
  initialized = true

  console.log(`[collab-service] redis pubsub ready channelPattern=${CHANNEL_PATTERN}`)
}

export const registerSessionDocument = (sessionId: string): WSSharedDoc => {
  return registerSessionBinding(sessionId).doc
}

export const shutdownPubSub = async (): Promise<void> => {
  if (!initialized) {
    return
  }

  for (const [sessionId, binding] of bindings) {
    binding.doc.off('update', binding.onUpdate)
    bindings.delete(sessionId)
  }

  await Promise.all([subscriber.quit(), publisher.quit()])
  initialized = false
}
