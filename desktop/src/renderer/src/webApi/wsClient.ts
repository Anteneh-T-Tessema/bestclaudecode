// Thin WebSocket transport matching the request/response + event shape of
// server/src/router.ts's dispatch()/attachSession() on the other end —
// invoke() mirrors ipcRenderer.invoke, on() mirrors ipcRenderer.on.
interface ResponseMessage {
  id: string
  ok: boolean
  result?: unknown
  error?: string
}

interface EventMessage {
  channel: string
  event: true
  payload: unknown
}

type EventListener = (payload: unknown) => void

export class MeshflowSocket {
  private ws: WebSocket
  private readonly pending = new Map<string, (response: ResponseMessage) => void>()
  private readonly eventListeners = new Map<string, Set<EventListener>>()
  private readonly ready: Promise<void>

  constructor(url: string) {
    this.ws = new WebSocket(url)
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve())
      this.ws.addEventListener('error', () => reject(new Error(`Failed to connect to Meshflow server at ${url}`)))
    })
    this.ws.addEventListener('message', (event: MessageEvent<string>) => {
      let msg: ResponseMessage | EventMessage
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }
      if ('event' in msg && msg.event) {
        const listeners = this.eventListeners.get(msg.channel)
        if (listeners) for (const cb of listeners) cb(msg.payload)
        return
      }
      const resolved = msg as ResponseMessage
      const resolve = this.pending.get(resolved.id)
      if (resolve) {
        this.pending.delete(resolved.id)
        resolve(resolved)
      }
    })
  }

  async invoke<T = unknown>(channel: string, payload?: unknown): Promise<T> {
    await this.ready
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    return new Promise((resolve, reject) => {
      this.pending.set(id, (response) => {
        if (response.ok) resolve(response.result as T)
        else reject(new Error(response.error ?? `Unknown error on channel "${channel}"`))
      })
      this.ws.send(JSON.stringify({ id, channel, payload }))
    })
  }

  on(channel: string, cb: EventListener): () => void {
    let set = this.eventListeners.get(channel)
    if (!set) {
      set = new Set()
      this.eventListeners.set(channel, set)
    }
    set.add(cb)
    return () => { set?.delete(cb) }
  }
}

const SERVER_URL = (import.meta.env.VITE_MESHFLOW_SERVER_URL as string | undefined) ?? 'ws://localhost:8787'

export const socket = new MeshflowSocket(SERVER_URL)
