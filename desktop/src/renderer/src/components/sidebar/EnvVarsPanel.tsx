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
// .env file(s) via the existing generic fs IPC, preserving comments/blank
// lines verbatim so re-saving never strips the user's own formatting.
// Discovers every .env anywhere in the project (not just the root) so
// monorepos with e.g. apps/web/.env and apps/api/.env are both reachable.
export function EnvVarsPanel() {
  const projectPath = useSettingsStore((s) => s.projectPath)
  const [envPaths, setEnvPaths] = useState<string[]>([])
  const [selectedPath, setSelectedPath] = useState('.env')
  const [lines, setLines] = useState<EnvLine[] | null>(null)
  const [isGitignored, setIsGitignored] = useState(true)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Re-discover .env files whenever the project changes, defaulting the
  // selection to the root .env (or the first one found if root has none).
  useEffect(() => {
    if (!projectPath) { setEnvPaths([]); return }
    window.api.fs.findEnvFiles(projectPath).then((found) => {
      setEnvPaths(found)
      setSelectedPath(found.includes('.env') ? '.env' : found[0] ?? '.env')
    }).catch(() => setEnvPaths([]))
  }, [projectPath])

  const load = useCallback(async () => {
    if (!projectPath) { setLines(null); return }
    try {
      const content = await window.api.fs.readFile(`${projectPath}/${selectedPath}`)
      setLines(parseEnv(content ?? ''))
    } catch {
      setLines([])
    }
    setDirty(false)
    try {
      const ignored = await window.api.fs.isGitignored(selectedPath)
      setIsGitignored(ignored)
    } catch {
      setIsGitignored(true)
    }
  }, [projectPath, selectedPath])

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
      await window.api.fs.writeFile(`${projectPath}/${selectedPath}`, serializeEnv(lines))
      setDirty(false)
      toast.success(`Saved ${selectedPath}`)
      // A brand-new file at a not-yet-discovered path just got created — make
      // sure it shows up in the selector on the next discovery pass too.
      setEnvPaths((prev) => (prev.includes(selectedPath) ? prev : [...prev, selectedPath]))
      try {
        setIsGitignored(await window.api.fs.isGitignored(selectedPath))
      } catch { /* ignore — banner just won't update until next reload */ }
    } catch (err) {
      toast.error(`Failed to save ${selectedPath}: ${(err as Error).message}`)
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
  // Always offer the selected path as an option, even if it's a brand-new
  // root .env that findEnvFiles hasn't discovered yet (file doesn't exist).
  const selectorOptions = envPaths.includes(selectedPath) ? envPaths : [...envPaths, selectedPath]

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
            title={`Save ${selectedPath}`}
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

      {/* Gap 141 loose end — monorepos can have multiple .env files; pick which one to edit. */}
      <div style={{ padding: '6px 10px', borderBottom: `1px solid ${border[1]}` }}>
        <select
          value={selectedPath}
          onChange={(e) => setSelectedPath(e.target.value)}
          title="Which .env file to edit"
          style={{
            width: '100%', boxSizing: 'border-box', background: surface.raised,
            border: `1px solid ${border[0]}`, borderRadius: 4, padding: '4px 6px',
            fontSize: 10.5, color: fg[0], outline: 'none', fontFamily: 'monospace',
          }}
        >
          {selectorOptions.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {!isGitignored && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 6, padding: '7px 10px',
          background: accent.amber.subtle, borderBottom: `1px solid ${border[1]}`,
        }}>
          <AlertTriangle size={12} color={accent.amber.fg} style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 10, color: accent.amber.fg, lineHeight: 1.4 }}>
            {selectedPath} is not in your .gitignore — committing it could leak secrets.
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
