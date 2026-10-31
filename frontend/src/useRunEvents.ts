// Hook: opens one EventSource for a run, accumulates its events, and closes the
// stream on a terminal event (complete / error). No automatic reconnect: a dropped
// connection becomes an explicit error state the UI can show.

import { useEffect, useState } from 'react'
import { eventsUrl, parseEvent, type AnyEvent } from './api'

export interface RunStream {
  events: AnyEvent[]
  done: boolean
  connectionError: string | null
}

const EMPTY: RunStream = { events: [], done: false, connectionError: null }

export function useRunEvents(runId: string | null): RunStream {
  // Keyed by run id, so a new run never shows the previous run's events, even for one render.
  const [state, setState] = useState<{ runId: string | null; stream: RunStream }>({ runId: null, stream: EMPTY })

  useEffect(() => {
    if (!runId) return
    let closed = false
    const source = new EventSource(eventsUrl(runId))
    const close = () => {
      closed = true
      source.close()
    }

    source.onmessage = (msg: MessageEvent<string>) => {
      const event = parseEvent(msg.data)
      const terminal = event.type === 'complete' || event.type === 'error'
      setState((prev) => {
        const base = prev.runId === runId ? prev.stream : EMPTY
        return { runId, stream: { ...base, events: [...base.events, event], done: base.done || terminal } }
      })
      if (terminal) close()
    }
    source.onerror = () => {
      if (closed) return
      close() // reconnect-free: stop here and report it
      setState((prev) => {
        const base = prev.runId === runId ? prev.stream : EMPTY
        if (base.done) return prev
        return { runId, stream: { ...base, connectionError: 'Lost the live connection to the backend.' } }
      })
    }
    return close
  }, [runId])

  return state.runId === runId ? state.stream : EMPTY
}
