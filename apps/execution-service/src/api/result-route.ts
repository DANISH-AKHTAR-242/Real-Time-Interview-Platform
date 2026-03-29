import { codeExecutionQueue } from '../queue/code-execution-queue.js'
import { getRequestIdentity } from '../security/identity.js'
import { parseJobIdParam } from '../utils/validation.js'

import type { FastifyInstance } from 'fastify'

type PublicJobStatus = 'waiting' | 'active' | 'completed' | 'failed'

const toPublicJobStatus = (state: string): PublicJobStatus => {
  if (state === 'active') {
    return 'active'
  }

  if (state === 'completed') {
    return 'completed'
  }

  if (state === 'failed') {
    return 'failed'
  }

  return 'waiting'
}

export const registerResultRoute = (server: FastifyInstance): void => {
  server.get('/result/:jobId', async (request, reply) => {
    const identity = getRequestIdentity(request)
    let jobId: string

    try {
      const params = request.params as { jobId?: unknown }
      jobId = parseJobIdParam(params.jobId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid jobId'
      return reply.code(400).send({ message })
    }

    try {
      const job = await codeExecutionQueue.getJob(jobId)

      if (!job) {
        return reply.code(404).send({ message: 'Job not found' })
      }

      if (job.data.ownerKey !== identity.ownerKey) {
        request.log.warn(
          {
            ownerKey: identity.ownerKey,
            jobId,
          },
          'result lookup blocked by ownership check',
        )

        return reply.code(404).send({ message: 'Job not found' })
      }

      const status = toPublicJobStatus(await job.getState())

      if (status === 'completed') {
        return reply.code(200).send({
          jobId,
          status,
          result: job.returnvalue ?? null,
        })
      }

      if (status === 'failed') {
        return reply.code(200).send({
          jobId,
          status,
          error: job.failedReason ?? 'Job failed',
        })
      }

      return reply.code(200).send({
        jobId,
        status,
      })
    } catch (error) {
      request.log.error(error)
      return reply.code(503).send({ message: 'Queue unavailable' })
    }
  })
}
