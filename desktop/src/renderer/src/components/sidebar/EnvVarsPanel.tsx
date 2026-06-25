import { useState, useEffect, useCallback } from 'react'
import { KeyRound, Eye, EyeOff, Trash2, Plus, Save, AlertTriangle } from 'lucide-react'
import { PanelHeader, accent, border, fg, surface } from '../../design'
import { useSettingsStore } from '../../store/useSettingsStore'
import { toast } from '../../store/useToastStore'
import { EmptyState } from '../EmptyState'

interface EnvLine {
  raw: string
  key: string | null // null for comments/blank lines, which are preserved verbatim
  value: string
}

const ENV_VAR_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/

function parseEnv(text: string): EnvLine[] {
  return text.split('\n').map((raw) => {
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) return { raw, key: null, value: '' }
    const m = trimmed.match(ENV_VAR_RE)
    if (!m) return { raw, key: null, value: '' }
    let value = m[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    return { raw, key: m[1], value }
  })
}

function serializeEnv(lines: EnvLine[]): string {
  return lines.map((l) => (l.key ? `${l.key}=${l.value}` : l.raw)).join('\n')
}

function EnvRow({
  line,
  onChange,
  onDelete,
}: {
  line: EnvLine
  onChange: (value: string) => void
  onDelete: () => void
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px' }}>
      <span
        title={line.key ?? ''}
        style={{
          fontSize: 10.5, fontFamily: 'monospace', color: fg[1], fontWeight: 600,
          width: 110, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {line.key}
      </span>
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', background: surface.raised,
        border: `1px solid ${border[0]}`, borderRadius: 4, padding: '0 4px 0 6px',
      }}>
        <input
          type={visible ? 'text' : 'password'}
          value={line.value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            fontSize: 10.5, color: fg[0], padding: '4px 0', fontFamily: 'monospace',
          }}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg[3], display: 'flex', padding: 2 }}
        >
          {visible ? <EyeOff size={11} /> : <Eye size={11} />}
        </button>
      </div>
      <button
        type="button"
        onClick={onDelete}
        title="Delete (renaming a key is delete + re-add)"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg[4], display: 'flex', padding: 2, flexShrink: 0 }}
      >
        <Trash2 size={11} />
      </button>
    </div>
  )
}

// Gap 141 — project .env manager, distinct from the IDE's own encrypted AI
// provider keys (Gap 88, SettingsPanel.tsx). Reads/writes the project's real
// .env file via the existing generic fs IPC, preserving comments/blank lines
// verbatim so re-saving never strips the user's own formatting.
export function EnvVarsPanel() {
  const projectPath = useSettingsStore((s) => s.projectPath)
  const [lines, setLines] = useState<EnvLine[] | null>(null)
  const [isGitignored, setIsGitignored] = useState(true)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    if (!projectPath) { setLines(null); return }
    try {
      const content = await window.api.fs.readFile(`${projectPath}/.env`)
      setLines(parseEnv(content ?? ''))
    } catch {
      setLines([])
    }
    setDirty(false)
    try {
      const ignored = await window.api.fs.isGitignored('.env')
      setIsGitignored(ignored)
    } catch {
      setIsGitignored(true)
    }
  }, [projectPath])

  useEffect(() => { void load() }, [load])

  const updateValue = (idx: number, value: string) => {
    setLines((prev) => prev?.map((l, i) => (i === idx ? { ...l, value } : l)) ?? prev)
    setDirty(true)
  }

  const deleteRow = (idx: number) => {
    setLines((prev) => prev?.filter((_, i) => i !== idx) ?? prev)
    setDirty(true)
  }

  const addRow = () => {
    const key = newKey.trim()
    if (!key || !ENV_VAR_RE.test(`${key}=`)) {
      toast.error('Key must start with a letter or underscore, and contain only letters, numbers, underscores')
      return
    }
    setLines((prev) => [...(prev ?? []), { raw: '', key, value: newValue }])
    setNewKey('')
    setNewValue('')
    setDirty(true)
  }

  const save = async () => {
    if (!projectPath || !lines) return
    setSaving(true)
    try {
      await window.api.fs.writeFile(`${projectPath}/.env`, serializeEnv(lines))
      setDirty(false)
      toast.success('Saved .env')
      try {
        setIsGitignored(await window.api.fs.isGitignored('.env'))
      } catch { /* ignore — banner just won't update until next reload */ }
    } catch (err) {
      toast.error(`Failed to save .env: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  if (!projectPath) {
    return (
      <EmptyState
        icon={<KeyRound size={20} />}
        title="No project open"
        description="Open a folder to manage its .env variables."
      />
    )
  }

  const rows = (lines ?? []).map((l, idx) => ({ line: l, idx })).filter((r) => r.line.key !== null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PanelHeader
        icon={<KeyRound style={{ width: 13, height: 13, color: accent.amber.fg }} />}
        label="Environment"
        actions={
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
            title="Save .env"
            style={{
              display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
              cursor: dirty && !saving ? 'pointer' : 'not-allowed',
              color: dirty ? accent.green.fg : fg[4],
            }}
          >
            <Save size={13} />
          </button>
        }
      />

      {!isGitignored && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 6, padding: '7px 10px',
          background: accent.amber.subtle, borderBottom: `1px solid ${border[1]}`,
        }}>
          <AlertTriangle size={12} color={accent.amber.fg} style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 10, color: accent.amber.fg, lineHeight: 1.4 }}>
            .env is not in your .gitignore — committing it could leak secrets.
          </span>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {rows.length === 0 ? (
          <EmptyState
            icon={<KeyRound size={20} />}
            title="No variables yet"
            description="Add a key below to get started."
          />
        ) : (
          rows.map(({ line, idx }) => (
            <EnvRow
              key={idx}
              line={line}
              onChange={(v) => updateValue(idx, v)}
              onDelete={() => deleteRow(idx)}
            />
          ))
        )}
      </div>

      <div style={{ display: 'flex', gap: 5, padding: '8px 10px', borderTop: `1px solid ${border[1]}`, flexShrink: 0 }}>
        <input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="KEY"
          style={{
            width: 100, flexShrink: 0, background: surface.raised, border: `1px solid ${border[0]}`,
            borderRadius: 4, padding: '5px 7px', fontSize: 10.5, color: fg[0], outline: 'none', fontFamily: 'monospace',
          }}
        />
        <input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="value"
          onKeyDown={(e) => { if (e.key === 'Enter') addRow() }}
          style={{
            flex: 1, background: surface.raised, border: `1px solid ${border[0]}`,
            borderRadius: 4, padding: '5px 7px', fontSize: 10.5, color: fg[0], outline: 'none', fontFamily: 'monospace',
          }}
        />
        <button
          type="button"
          onClick={addRow}
          title="Add"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, flexShrink: 0,
            borderRadius: 4, border: `1px solid ${border[0]}`, background: surface.raised, color: fg[2], cursor: 'pointer',
          }}
        >
          <Plus size={13} />
        </button>
      </div>
    </div>
  )
}
