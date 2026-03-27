import { registerSessionDocument } from '../redis/pubsub.js'

import type { WSSharedDoc } from '@y/websocket-server/utils'

export const getOrCreateSessionDoc = (sessionId: string): WSSharedDoc => {
  return registerSessionDocument(sessionId)
}
