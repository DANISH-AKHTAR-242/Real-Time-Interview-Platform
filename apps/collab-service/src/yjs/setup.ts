import { getYDoc } from '@y/websocket-server/utils'

import type { WSSharedDoc } from '@y/websocket-server/utils'

export const getOrCreateSessionDoc = (sessionId: string): WSSharedDoc => {
  return getYDoc(sessionId)
}
