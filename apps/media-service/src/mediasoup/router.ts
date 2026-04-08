import type { MediasoupWorker } from './worker.js'

export const createMediasoupRouter = async (worker: MediasoupWorker) => {
  return worker.createRouter({
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
      },
    ],
  })
}

export type MediasoupRouter = Awaited<ReturnType<typeof createMediasoupRouter>>
