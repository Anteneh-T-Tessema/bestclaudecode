import { useState, useEffect, useRef, useCallback } from 'react'
import { ShieldAlert, Save, FlaskConical, BookmarkPlus } from 'lucide-react'
import { accent, border, fg, surface } from '../../design'
import { useSettingsStore } from '../../store/useSettingsStore'
import { toast } from '../../store/useToastStore'
import { POLICY_TEMPLATES, type PolicyConfig, type PolicyTemplate } from '../../policyTemplates'

const EMPTY_CONFIG: PolicyConfig = { block_commands: [], block_paths: [], require_approval_for: [] }
const TEMPLATES_DIR = (projectPath: string) => `${projectPath}/.lakoora/policy-templates`

function toLines(values: string[]): string {
  return values.join('\n')
}

function fromLines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean)
}

interface FieldProps {
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
}

function PatternField({ label, placeholder, value, onChange }: FieldProps) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: fg[3], marginBottom: 4, fontWeight: 600 }}>{label}</div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        style={{
          width: '100%', background: surface.raised, border: `1px solid ${border[0]}`,
          borderRadius: 4, padding: '6px 8px', fontSize: 10.5, color: fg[0],
          fontFamily: 'monospace', lineHeight: 1.5, resize: 'vertical', outline: 'none', boxSizing: 'border-box',
        }}
      />
    </div>
  )
}

/** Gap 62/63/67/82 — visual editor for .lakoorapolicies.json: load/save via plain fs, starter templates, dry-run tester, and custom template save/load. */
export function PolicySection() {
  const projectPath = useSettingsStore((s) => s.projectPath)
  const [config, setConfig] = useState<PolicyConfig>(EMPTY_CONFIG)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [customTemplates, setCustomTemplates] = useState<PolicyTemplate[]>([])
  const [templateName, setTemplateName] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)
  const loadedFor = useRef<string | null>(null)

  const loadCustomTemplates = useCallback(async (pp: string) => {
    const dir = TEMPLATES_DIR(pp)
    try {
      const entries = await window.api.fs.readDir(dir) as Array<{ name: string; path: string; isDirectory: boolean }>
      const loaded: PolicyTemplate[] = []
      for (const e of entries) {
        if (!e.name.endsWith('.json') || e.isDirectory) continue
        try {
          const raw = JSON.parse(await window.api.fs.readFile(e.path)) as Partial<PolicyConfig & { name?: string }>
          loaded.push({
            id: `custom:${e.name.replace(/\.json$/, '')}`,
            name: raw.name ?? e.name.replace(/\.json$/, ''),
            description: 'Custom template',
            config: {
              block_commands: Array.isArray(raw.block_commands) ? raw.block_commands : [],
              block_paths: Array.isArray(raw.block_paths) ? raw.block_paths : [],
              require_approval_for: Array.isArray(raw.require_approval_for) ? raw.require_approval_for : [],
            },
          })
        } catch { /* skip corrupt file */ }
      }
      setCustomTemplates(loaded)
    } catch {
      setCustomTemplates([])
    }
  }, [])

  useEffect(() => {
    if (!projectPath || loadedFor.current === projectPath) return
    loadedFor.current = projectPath
    window.api.fs.readFile(`${projectPath}/.lakoorapolicies.json`)
      .then((content) => {
        try {
          const parsed = JSON.parse(content) as Partial<PolicyConfig>
          setConfig({
            block_commands: Array.isArray(parsed.block_commands) ? parsed.block_commands : [],
            block_paths: Array.isArray(parsed.block_paths) ? parsed.block_paths : [],
            require_approval_for: Array.isArray(parsed.require_approval_for) ? parsed.require_approval_for : [],
          })
        } catch {
          setConfig(EMPTY_CONFIG)
        }
      })
      .catch(() => setConfig(EMPTY_CONFIG))
    loadCustomTemplates(projectPath)
  }, [projectPath, loadCustomTemplates])

  const save = useCallback(async () => {
    if (!projectPath) return
    setSaving(true)
    try {
      await window.api.fs.writeFile(`${projectPath}/.lakoorapolicies.json`, JSON.stringify(config, null, 2))
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch {
      toast.error('Failed to save .lakoorapolicies.json')
    } finally {
      setSaving(false)
    }
  }, [projectPath, config])

  const applyTemplate = (templateId: string) => {
    const all = [...POLICY_TEMPLATES, ...customTemplates]
    const template = all.find((t) => t.id === templateId)
    if (template) { setConfig(template.config); setSaved(false) }
  }

  const saveAsTemplate = useCallback(async () => {
    if (!projectPath || !templateName.trim()) return
    setSavingTemplate(true)
    try {
      const dir = TEMPLATES_DIR(projectPath)
      await window.api.fs.createDir(dir)
      const slug = templateName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')
      const payload = { name: templateName.trim(), ...config }
      await window.api.fs.writeFile(`${dir}/${slug}.json`, JSON.stringify(payload, null, 2))
      setTemplateName('')
      await loadCustomTemplates(projectPath)
      toast.success(`Template "${templateName.trim()}" saved`)
    } catch {
      toast.error('Failed to save custom template')
    } finally {
      setSavingTemplate(false)
    }
  }, [projectPath, templateName, config, loadCustomTemplates])

  // Gap 67 — dry-run tester against the in-memory draft, not the saved file.
  const [testKind, setTestKind] = useState<'command' | 'path' | 'approval'>('command')
  const [testValue, setTestValue] = useState('')
  const [testResult, setTestResult] = useState<{ rule: string; pattern: string } | null | undefined>(undefined)

  const runTest = async () => {
    if (!testValue.trim()) return
    const result = await window.api.policy.test({ kind: testKind, value: testValue, config })
    setTestResult(result)
  }

  return (
    <div>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: fg[3], marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${border[1]}`,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <ShieldAlert size={11} color={accent.violet.fg} /> Agent Policies (.lakoorapolicies.json)
      </div>
      <p style={{ fontSize: 10, color: fg[3], margin: '0 0 8px', lineHeight: 1.5 }}>
        Governance rules the autonomous agent enforces before every edit and command — one pattern per line.
        {!projectPath && <span style={{ color: accent.amber.fg }}> Open a project to edit.</span>}
      </p>

      <div style={{ marginBottom: 10 }}>
        <select
          defaultValue=""
          onChange={(e) => { if (e.target.value) applyTemplate(e.target.value); e.target.value = '' }}
          title="Load a starter template into the draft below"
          disabled={!projectPath}
          style={{
            width: '100%', background: surface.raised, border: `1px solid ${border[0]}`,
            borderRadius: 4, padding: '5px 8px', fontSize: 10.5, color: fg[0], outline: 'none',
          }}
        >
          <option value="">Load a starter template…</option>
          {POLICY_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.description}</option>)}
          {customTemplates.length > 0 && <option disabled>── Custom ──</option>}
          {customTemplates.map((t) => <option key={t.id} value={t.id}>⭐ {t.name}</option>)}
        </select>
      </div>

      <PatternField
        label="Blocked commands (regex, one per line)"
        placeholder={'rm -rf /\ncurl.*\\|.*bash'}
        value={toLines(config.block_commands)}
        onChange={(v) => setConfig((c) => ({ ...c, block_commands: fromLines(v) }))}
      />
      <PatternField
        label="Blocked paths (glob, one per line)"
        placeholder={'.env\n*.pem\nsecrets/*'}
        value={toLines(config.block_paths)}
        onChange={(v) => setConfig((c) => ({ ...c, block_paths: fromLines(v) }))}
      />
      <PatternField
        label="Require approval for (regex, one per line)"
        placeholder={'deploy\npush.*production'}
        value={toLines(config.require_approval_for)}
        onChange={(v) => setConfig((c) => ({ ...c, require_approval_for: fromLines(v) }))}
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 8 }}>
        <button
          type="button"
          onClick={save}
          disabled={!projectPath || saving}
          title="Save .lakoorapolicies.json"
          style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', fontSize: 10, fontWeight: 600, borderRadius: 4,
            border: `1px solid ${saved ? accent.green.border : border[0]}`,
            background: saved ? accent.green.subtle : surface.raised,
            color: saved ? accent.green.fg : fg[2],
            cursor: projectPath && !saving ? 'pointer' : 'not-allowed',
          }}
        >
          <Save size={10} />
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, alignItems: 'center' }}>
        <BookmarkPlus size={11} color={fg[3]} style={{ flexShrink: 0 }} />
        <input
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          placeholder="Template name…"
          disabled={!projectPath}
          style={{
            flex: 1, background: surface.raised, border: `1px solid ${border[0]}`,
            borderRadius: 4, padding: '4px 8px', fontSize: 10.5, color: fg[0], outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={saveAsTemplate}
          disabled={!projectPath || !templateName.trim() || savingTemplate}
          title="Save current draft as a named custom template"
          style={{
            flexShrink: 0, fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 4,
            border: `1px solid ${border[0]}`, background: surface.raised, color: fg[2],
            cursor: projectPath && templateName.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          {savingTemplate ? 'Saving…' : 'Save as template'}
        </button>
      </div>

      <div style={{ paddingTop: 10, borderTop: `1px solid ${border[2]}` }}>
        <div style={{ fontSize: 10, color: fg[3], marginBottom: 6, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
          <FlaskConical size={11} /> Test a rule (dry run — uses the draft above)
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            value={testKind}
            onChange={(e) => setTestKind(e.target.value as 'command' | 'path' | 'approval')}
            title="What kind of value to test"
            style={{
              flexShrink: 0, background: surface.raised, border: `1px solid ${border[0]}`,
              borderRadius: 4, padding: '5px 6px', fontSize: 10.5, color: fg[0], outline: 'none',
            }}
          >
            <option value="command">Command</option>
            <option value="path">Path</option>
            <option value="approval">Approval text</option>
          </select>
          <input
            value={testValue}
            onChange={(e) => { setTestValue(e.target.value); setTestResult(undefined) }}
            placeholder={testKind === 'path' ? 'e.g. secrets/aws-keys.json' : 'e.g. deploy to production'}
            style={{
              flex: 1, background: surface.raised, border: `1px solid ${border[0]}`,
              borderRadius: 4, padding: '5px 8px', fontSize: 10.5, color: fg[0], outline: 'none', minWidth: 0,
            }}
          />
          <button
            type="button"
            onClick={runTest}
            disabled={!testValue.trim()}
            style={{
              flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '5px 10px', borderRadius: 4,
              background: accent.violet.fg, border: 'none', color: '#fff',
              cursor: testValue.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            Test
          </button>
        </div>
        {testResult !== undefined && (
          <div style={{
            marginTop: 6, fontSize: 10.5, fontWeight: 600,
            color: testResult ? accent.amber.fg : accent.green.fg,
          }}>
            {testResult
              ? `⚠ Matches "${testResult.pattern}" (${testResult.rule})`
              : '✓ No rule matches — this would proceed.'}
          </div>
        )}
      </div>
    </div>
  )
}
