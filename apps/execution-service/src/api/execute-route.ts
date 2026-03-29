import { randomUUID } from 'node:crypto'

import { codeExecutionQueue } from '../queue/code-execution-queue.js'
import { getRequestIdentity } from '../security/identity.js'
import { executionSecurityPolicy } from '../security/policy.js'
import {
  getGlobalPendingJobCount,
  releaseOwnerQueueSlot,
  reserveOwnerQueueSlot,
} from '../security/queue-guard.js'
import { enforceExecutionRateLimit } from '../security/rate-limit.js'
import { parseExecuteRequestBody } from '../utils/validation.js'

import type { FastifyInstance } from 'fastify'

export const registerExecuteRoute = (server: FastifyInstance): void => {
  server.post('/execute', async (request, reply) => {
    const identity = getRequestIdentity(request)

    try {
      const rateLimitDecision = await enforceExecutionRateLimit(identity)

      if (!rateLimitDecision.allowed) {
        request.log.warn(
          {
            ownerKey: identity.ownerKey,
            scope: rateLimitDecision.scope,
          },
          'execution request blocked by rate limiter',
        )

        return reply
          .header('Retry-After', String(rateLimitDecision.retryAfterSeconds))
          .code(429)
          .send({ message: 'Rate limit exceeded' })
      }
    } catch (error) {
      request.log.error(error)
      return reply.code(503).send({ message: 'Rate limiter unavailable' })
    }

    let payload

    try {
      payload = parseExecuteRequestBody(request.body)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bad request'
      return reply.code(400).send({ message })
    }

    try {
      const globalPendingJobs = await getGlobalPendingJobCount()

      if (globalPendingJobs >= executionSecurityPolicy.maxGlobalPendingJobs) {
        request.log.warn(
          {
            ownerKey: identity.ownerKey,
            globalPendingJobs,
          },
          'execution request blocked by global queue limit',
        )

        return reply.code(429).send({ message: 'Queue is busy. Retry later.' })
      }
    } catch (error) {
      request.log.error(error)
      return reply.code(503).send({ message: 'Queue unavailable' })
    }

    let ownerSlotReserved = false
    let jobQueued = false

    try {
      ownerSlotReserved = await reserveOwnerQueueSlot(identity.ownerKey)

      if (!ownerSlotReserved) {
        request.log.warn(
          {
            ownerKey: identity.ownerKey,
          },
          'execution request blocked by per-owner queue limit',
        )

        return reply.code(429).send({ message: 'Too many pending jobs for requester' })
      }

      const job = await codeExecutionQueue.add(
        'execute',
        {
          ...payload,
          ownerKey: identity.ownerKey,
          submittedAtMs: Date.now(),
        },
        {
          jobId: randomUUID(),
        },
      )

      jobQueued = true

      request.log.info(
        {
          jobId: String(job.id),
          language: payload.language,
          ownerKey: identity.ownerKey,
          codeSizeBytes: Buffer.byteLength(payload.code, 'utf8'),
        },
        'execution job accepted',
      )

      return reply.code(202).send({ jobId: String(job.id) })
    } catch (error) {
      request.log.error(error)
      return reply.code(503).send({ message: 'Queue unavailable' })
    } finally {
      if (ownerSlotReserved && !jobQueued) {
        try {
          await releaseOwnerQueueSlot(identity.ownerKey)
        } catch (releaseError) {
          request.log.error(releaseError)
        }
      }
    }
  })
}
