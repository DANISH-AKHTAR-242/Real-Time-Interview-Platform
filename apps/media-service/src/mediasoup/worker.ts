import * as mediasoup from 'mediasoup'

export type MediasoupWorker = Awaited<ReturnType<typeof mediasoup.createWorker>>

const parsePort = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10)

  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed
  }

  return fallback
}

export const createMediasoupWorker = async (): Promise<MediasoupWorker> => {
  const worker = await mediasoup.createWorker({
    rtcMinPort: parsePort(process.env.MEDIASOUP_MIN_PORT, 40000),
    rtcMaxPort: parsePort(process.env.MEDIASOUP_MAX_PORT, 49999),
  })

  worker.on('died', () => {
    console.error('mediasoup worker died, exiting process in 2s')
    setTimeout(() => process.exit(1), 2000).unref()
  })

  return worker
}
