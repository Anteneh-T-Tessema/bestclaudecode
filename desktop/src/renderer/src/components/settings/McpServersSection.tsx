import { useState, useEffect, useCallback } from 'react'
import { Plug, PlugZap, Trash2, Plus, Loader2 } from 'lucide-react'
import { accent, border, fg, surface } from '../../design'
import { toast } from '../../store/useToastStore'

interface McpServerStatus {
  id: string
  name: string
  command: string
  args: string[]
  connected: boolean
  toolCount: number
  error?: string
}

export function McpServersSection() {
  const [servers, setServers] = useState<McpServerStatus[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [adding, setAdding] = useState(false)

  const refresh = useCallback(async () => {
    setServers(await window.api.mcp.listServers())
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const addServer = async () => {
    if (!name.trim() || !command.trim()) return
    setAdding(true)
    try {
      await window.api.mcp.addServer({
        name: name.trim(),
        command: command.trim(),
        args: args.trim() ? args.trim().split(/\s+/) : [],
      })
      setName(''); setCommand(''); setArgs(''); setFormOpen(false)
      await refresh()
      toast.success('MCP server added')
    } finally {
      setAdding(false)
    }
  }

  const removeServer = async (id: string) => {
    setBusyId(id)
    try {
      await window.api.mcp.removeServer(id)
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  const toggleConnect = async (s: McpServerStatus) => {
    setBusyId(s.id)
    try {
      if (s.connected) {
        await window.api.mcp.disconnect(s.id)
      } else {
        const result = await window.api.mcp.connect(s.id)
        if (!result.success) toast.error(`Connect failed: ${result.error ?? 'unknown error'}`)
        else toast.success(`Connected · ${result.toolCount ?? 0} tool${result.toolCount === 1 ? '' : 's'}`)
      }
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: fg[3], marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${border[1]}`,
      }}>
        <span>MCP Servers</span>
        <button
          type="button"
          onClick={() => setFormOpen((v) => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: accent.violet.fg, display: 'flex', alignItems: 'center', gap: 2, textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}
        >
          <Plus size={11} /> Add
        </button>
      </div>

      <p style={{ fontSize: 10, color: fg[3], margin: '0 0 10px', lineHeight: 1.5 }}>
        Connect Model Context Protocol servers to give the AI chat tools it can call
        (Claude only, currently). Configured servers auto-connect on launch.
      </p>

      {formOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10, padding: 8, background: surface.raised, border: `1px solid ${border[1]}`, borderRadius: 6 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (e.g. build-log-server)"
            style={{ background: surface.base, border: `1px solid ${border[0]}`, borderRadius: 4, padding: '5px 8px', fontSize: 11, color: fg[0], outline: 'none' }}
          />
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="Command (e.g. node)"
            style={{ background: surface.base, border: `1px solid ${border[0]}`, borderRadius: 4, padding: '5px 8px', fontSize: 11, color: fg[0], outline: 'none' }}
          />
          <input
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder="Args (space-separated, e.g. mcp-servers/build-log-server/dist/index.js)"
            style={{ background: surface.base, border: `1px solid ${border[0]}`, borderRadius: 4, padding: '5px 8px', fontSize: 11, color: fg[0], outline: 'none', fontFamily: 'monospace' }}
          />
          <button
            type="button"
            onClick={addServer}
            disabled={!name.trim() || !command.trim() || adding}
            style={{
              alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: 4,
              background: (name.trim() && command.trim()) ? accent.violet.fg : surface.base,
              border: 'none', borderRadius: 4, padding: '5px 10px', fontSize: 11, fontWeight: 700,
              color: (name.trim() && command.trim()) ? '#fff' : fg[4],
              cursor: (name.trim() && command.trim() && !adding) ? 'pointer' : 'not-allowed',
            }}
          >
            {adding && <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />}
            {adding ? 'Adding…' : 'Add server'}
          </button>
        </div>
      )}

      {servers.length === 0 ? (
        <div style={{ fontSize: 10, color: fg[4] }}>No MCP servers configured.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {servers.map((s) => (
            <div
              key={s.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '6px 8px', background: surface.raised, border: `1px solid ${border[1]}`, borderRadius: 4,
              }}
            >
              <span style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: s.error ? accent.red.fg : s.connected ? accent.green.fg : fg[4],
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: fg[1], fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.name}
                </div>
                <div style={{ fontSize: 9, color: fg[4], fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.connected ? `${s.toolCount} tool${s.toolCount === 1 ? '' : 's'}` : s.error ? s.error : `${s.command} ${s.args.join(' ')}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => toggleConnect(s)}
                disabled={busyId === s.id}
                title={s.connected ? 'Disconnect' : 'Connect'}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: s.connected ? accent.green.fg : fg[3], padding: 3, display: 'flex', alignItems: 'center' }}
              >
                {busyId === s.id ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : s.connected ? <PlugZap size={12} /> : <Plug size={12} />}
              </button>
              <button
                type="button"
                onClick={() => removeServer(s.id)}
                disabled={busyId === s.id}
                title="Remove server"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg[4], padding: 3, display: 'flex', alignItems: 'center' }}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
