import { useEffect, useRef } from 'react'

import * as monaco from 'monaco-editor'
import { MonacoBinding } from 'y-monaco'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'

interface CollabEditorProps {
  sessionId: string
}

interface PresenceUser {
  name: string
  color: string
}

interface PresenceCursor {
  anchor: number
  head: number
}

interface PresenceState {
  user?: PresenceUser
  cursor?: PresenceCursor
}

const colors = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2']

const randomColor = (): string => {
  return colors[Math.floor(Math.random() * colors.length)] ?? '#2563eb'
}

const randomUserName = (): string => {
  return `User-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`
}

const cursorClassName = (clientId: number): string => `remote-cursor-${clientId}`
const cursorLabelClassName = (clientId: number): string => `remote-cursor-label-${clientId}`

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

    const awareness = provider.awareness

    const model = monaco.editor.createModel('', 'typescript')
    const editor = monaco.editor.create(container, {
      model,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 14,
      tabSize: 2,
    })

    const binding = new MonacoBinding(yText, model, new Set([editor]), awareness)

    const localUser: PresenceUser = {
      name: randomUserName(),
      color: randomColor(),
    }

    awareness.setLocalStateField('user', localUser)

    let decorationIds: string[] = []
    const styleElement = document.createElement('style')
    document.head.appendChild(styleElement)
    const styleRules = new Map<number, string>()

    const updateLocalCursorPresence = (): void => {
      const selection = editor.getSelection()

      if (!selection) {
        awareness.setLocalStateField('cursor', null)
        return
      }

      const anchor = model.getOffsetAt(selection.getStartPosition())
      const head = model.getOffsetAt(selection.getEndPosition())

      awareness.setLocalStateField('cursor', {
        anchor,
        head,
      } satisfies PresenceCursor)
    }

    const ensureClientStyles = (clientId: number, user: PresenceUser): void => {
      if (styleRules.has(clientId)) {
        return
      }

      const rule = `
        .monaco-editor .${cursorClassName(clientId)} {
          border-left: 2px solid ${user.color};
        }

        .monaco-editor .${cursorLabelClassName(clientId)}::after {
          content: '${user.name.replace(/'/g, "\\'")}';
          position: absolute;
          top: -1.35em;
          left: 0;
          background: ${user.color};
          color: #ffffff;
          font-size: 11px;
          line-height: 1;
          padding: 2px 6px;
          border-radius: 3px;
          white-space: nowrap;
        }
      `

      styleRules.set(clientId, rule)
      styleElement.textContent = Array.from(styleRules.values()).join('\n')
    }

    const updateRemoteDecorations = (): void => {
      const states = awareness.getStates()
      const localClientId = awareness.clientID

      const decorations: monaco.editor.IModelDeltaDecoration[] = []

      states.forEach((rawState, clientId) => {
        if (clientId === localClientId) {
          return
        }

        const state = rawState as PresenceState

        if (!state.user || !state.cursor) {
          return
        }

        const cursorOffset = Math.max(0, Math.min(model.getValueLength(), state.cursor.head))
        const cursorPosition = model.getPositionAt(cursorOffset)
        ensureClientStyles(clientId, state.user)

        decorations.push({
          range: new monaco.Range(
            cursorPosition.lineNumber,
            cursorPosition.column,
            cursorPosition.lineNumber,
            cursorPosition.column,
          ),
          options: {
            className: cursorClassName(clientId),
            afterContentClassName: cursorLabelClassName(clientId),
          },
        })
      })

      decorationIds = editor.deltaDecorations(decorationIds, decorations)
    }

    const selectionDisposable = editor.onDidChangeCursorSelection(() => {
      updateLocalCursorPresence()
    })

    const awarenessUpdateHandler = (): void => {
      updateRemoteDecorations()
    }

    awareness.on('change', awarenessUpdateHandler)

    provider.on('status', (event: { status: string }) => {
      console.log(`[frontend] y-websocket ${event.status} session=${sessionId}`)
    })

    updateLocalCursorPresence()
    updateRemoteDecorations()

    return () => {
      awareness.off('change', awarenessUpdateHandler)
      awareness.setLocalState(null)
      selectionDisposable.dispose()
      binding.destroy()
      provider.destroy()
      decorationIds = editor.deltaDecorations(decorationIds, [])
      editor.dispose()
      model.dispose()
      doc.destroy()
      styleElement.remove()
    }
  }, [sessionId])

  return <div className="editor-container" ref={containerRef} />
}
