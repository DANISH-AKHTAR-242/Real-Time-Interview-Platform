import { useEffect, useRef } from 'react'

import * as monaco from 'monaco-editor'
import { MonacoBinding } from 'y-monaco'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'

interface CollabEditorProps {
  sessionId: string
}

export const CollabEditor = ({ sessionId }: CollabEditorProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current

    if (!container) {
      return
    }

    const doc = new Y.Doc()
    const yText = doc.getText('monaco')

    const provider = new WebsocketProvider('ws://localhost:3002', sessionId, doc, {
      connect: true,
    })

    const model = monaco.editor.createModel('', 'typescript')
    const editor = monaco.editor.create(container, {
      model,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 14,
      tabSize: 2,
    })

    const binding = new MonacoBinding(yText, model, new Set([editor]), provider.awareness)

    provider.on('status', (event: { status: string }) => {
      console.log(`[frontend] y-websocket ${event.status} session=${sessionId}`)
    })

    return () => {
      binding.destroy()
      provider.destroy()
      editor.dispose()
      model.dispose()
      doc.destroy()
    }
  }, [sessionId])

  return <div className="editor-container" ref={containerRef} />
}
