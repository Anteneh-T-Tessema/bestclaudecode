import { useState, useCallback, useEffect, useRef } from 'react'
import { Settings, Circle, Eye, EyeOff, Check, FolderOpen, Save } from 'lucide-react'
import { PanelHeader, Button, accent, border, fg, surface } from '../../design'
import { useSettingsStore } from '../../store/useSettingsStore'
import { toast } from '../../store/useToastStore'
import { ModelSelector } from '../chat/ModelSelector'
import { McpServersSection } from './McpServersSection'
import { PolicySection } from './PolicySection'
import { CacheSection } from './CacheSection'

interface EngineHealth {
  repoRoot: string
  pythonFound: boolean
  pytestFound: boolean
  ruffFound: boolean
}

interface BridgeResult {
  ok: boolean
  stats?: unknown
  error?: string
}

function ApiKeyField({
  label,
  value,
  onChange,
  onSave,
  onValidate,
  placeholder,
  saved,
  secret = true,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onSave: () => void
  onValidate?: () => Promise<{ valid: boolean; error?: string }>
  placeholder: string
  saved: boolean
  secret?: boolean
}) {
  const [visible, setVisible] = useState(false)
  const [validating, setValidating] = useState(false)
  const [validity, setValidity] = useState<{ valid: boolean; error?: string } | null>(null)

  const handleValidate = async () => {
    if (!onValidate || !value.trim()) return
    setValidating(true)
    setValidity(null)
    try {
      const result = await onValidate()
      setValidity(result)
    } finally {
      setValidating(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 10, color: fg[2], fontWeight: 600 }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            background: surface.raised,
            border: `1px solid ${border[0]}`,
            borderRadius: 4,
            padding: '0 6px 0 8px',
          }}
        >
          <input
            type={!secret || visible ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSave()
            }}
            placeholder={placeholder}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 11,
              color: fg[0],
              padding: '6px 0',
              fontFamily: 'monospace',
            }}
          />
          {secret && (
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg[3], display: 'flex', padding: 2 }}
            >
              {visible ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onSave}
          title="Save"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 26,
            height: 26,
            flexShrink: 0,
            borderRadius: 4,
            border: `1px solid ${saved ? accent.green.border : border[0]}`,
            background: saved ? accent.green.subtle : surface.raised,
            color: saved ? accent.green.fg : fg[3],
            cursor: 'pointer',
          }}
        >
          <Check size={12} />
        </button>
      </div>
      {onValidate && value.trim() && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <button
            type="button"
            onClick={handleValidate}
            disabled={validating}
            style={{
              fontSize: 9, padding: '2px 8px', borderRadius: 4,
              background: 'transparent', border: `1px solid ${border[1]}`,
              color: fg[3], cursor: validating ? 'not-allowed' : 'pointer',
            }}
          >
            {validating ? 'Validating…' : 'Validate key'}
          </button>
          {validity && (
            <span style={{
              fontSize: 9, fontWeight: 700,
              color: validity.valid ? accent.green.fg : accent.red.fg,
            }}>
              {validity.valid ? '✓ Valid' : `✗ ${validity.error ?? 'Invalid key'}`}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
      <Circle
        style={{
          width: 7, height: 7, flexShrink: 0,
          fill: ok ? accent.green.fg : accent.red.fg,
          color: ok ? accent.green.fg : accent.red.fg,
        }}
      />
      <span style={{ color: fg[1], minWidth: 120 }}>{label}</span>
      {detail && (
        <span style={{
          color: fg[3], fontFamily: 'monospace', fontSize: 9,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
        }}>
          {detail}
        </span>
      )}
    </div>
  )
}

export function SettingsPanel() {
  const [engine, setEngine] = useState<EngineHealth | null>(null)
  const [bridge, setBridge] = useState<BridgeResult | null>(null)
  const [checking, setChecking] = useState(false)

  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const storeAnthropicKey = useSettingsStore((s) => s.anthropicApiKey)
  const storeOpenaiKey = useSettingsStore((s) => s.openaiApiKey)
  const storeGoogleKey = useSettingsStore((s) => s.googleApiKey)
  const storeOllamaUrl = useSettingsStore((s) => s.ollamaUrl)
  const recentProjects = useSettingsStore((s) => s.recentProjects)
  const projectPath = useSettingsStore((s) => s.projectPath)
  const storeGlobalRules = useSettingsStore((s) => s.globalRules)
  const saveSettings = useSettingsStore((s) => s.save)

  const [anthropicKey, setAnthropicKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [googleKey, setGoogleKey] = useState('')
  const [ollamaUrl, setOllamaUrl] = useState('')
  const [savedField, setSavedField] = useState<string | null>(null)

  // .lakoorarules editor
  const [rules, setRules] = useState('')
  const [rulesSaving, setRulesSaving] = useState(false)
  const [rulesSaved, setRulesSaved] = useState(false)
  const rulesLoadedFor = useRef<string | null>(null)

  // Global rules editor (cross-project, persisted via the settings store)
  const [globalRulesDraft, setGlobalRulesDraft] = useState('')
  const [globalRulesSaving, setGlobalRulesSaving] = useState(false)
  const [globalRulesSaved, setGlobalRulesSaved] = useState(false)
  const globalRulesLoaded = useRef(false)

  useEffect(() => {
    if (!settingsLoaded) return
    setAnthropicKey(storeAnthropicKey)
    setOpenaiKey(storeOpenaiKey)
    setGoogleKey(storeGoogleKey)
    setOllamaUrl(storeOllamaUrl)
    if (!globalRulesLoaded.current) {
      setGlobalRulesDraft(storeGlobalRules)
      globalRulesLoaded.current = true
    }
  }, [settingsLoaded, storeAnthropicKey, storeOpenaiKey, storeGoogleKey, storeOllamaUrl, storeGlobalRules])

  const saveGlobalRules = async () => {
    setGlobalRulesSaving(true)
    try {
      await saveSettings({ globalRules: globalRulesDraft })
      setGlobalRulesSaved(true)
      setTimeout(() => setGlobalRulesSaved(false), 1500)
    } catch {
      toast.error('Failed to save global rules')
    } finally {
      setGlobalRulesSaving(false)
    }
  }

  useEffect(() => {
    if (!projectPath || rulesLoadedFor.current === projectPath) return
    rulesLoadedFor.current = projectPath
    window.api.fs.readFile(`${projectPath}/.lakoorarules`)
      .then((content) => setRules(content ?? ''))
      .catch(() => setRules(''))
  }, [projectPath])

  const saveRules = async () => {
    if (!projectPath) return
    setRulesSaving(true)
    try {
      await window.api.fs.writeFile(`${projectPath}/.lakoorarules`, rules)
      setRulesSaved(true)
      setTimeout(() => setRulesSaved(false), 1500)
    } catch {
      toast.error('Failed to save .lakoorarules')
    } finally {
      setRulesSaving(false)
    }
  }

  const flashSaved = (field: string) => {
    setSavedField(field)
    setTimeout(() => setSavedField((f) => (f === field ? null : f)), 1500)
  }

  const saveKey = useCallback(
    async (field: 'anthropicApiKey' | 'openaiApiKey' | 'googleApiKey' | 'ollamaUrl', value: string) => {
      await saveSettings({ [field]: value })
      toast.success('Saved')
      flashSaved(field)
    },
    [saveSettings]
  )

  const checkAll = useCallback(async () => {
    setChecking(true)
    try {
      const [health, bridgeResult] = await Promise.all([
        window.api.settings.checkEngine(),
        window.api.settings.pythonBridgeCheck(),
      ])
      setEngine(health)
      setBridge(bridgeResult)
    } finally {
      setChecking(false)
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PanelHeader
        icon={<Settings style={{ width: 13, height: 13, color: fg[2] }} />}
        label="Settings"
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: fg[3], marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${border[1]}`,
          }}>
            AI Providers
          </div>
          <p style={{ fontSize: 10, color: fg[3], margin: '0 0 10px', lineHeight: 1.5 }}>
            Required for AI Chat and Cmd+K inline edit. Keys are stored locally via electron-store, never sent anywhere but the provider you select.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ApiKeyField
              label="Anthropic API Key"
              value={anthropicKey}
              onChange={setAnthropicKey}
              onSave={() => saveKey('anthropicApiKey', anthropicKey)}
              onValidate={() => window.api.settings.validateKey('anthropic', anthropicKey)}
              placeholder="sk-ant-…"
              saved={savedField === 'anthropicApiKey'}
            />
            <ApiKeyField
              label="OpenAI API Key"
              value={openaiKey}
              onChange={setOpenaiKey}
              onSave={() => saveKey('openaiApiKey', openaiKey)}
              onValidate={() => window.api.settings.validateKey('openai', openaiKey)}
              placeholder="sk-…"
              saved={savedField === 'openaiApiKey'}
            />
            <ApiKeyField
              label="Google API Key"
              value={googleKey}
              onChange={setGoogleKey}
              onSave={() => saveKey('googleApiKey', googleKey)}
              placeholder="AIza…"
              saved={savedField === 'googleApiKey'}
            />
            <ApiKeyField
              label="Ollama URL"
              value={ollamaUrl}
              onChange={setOllamaUrl}
              onSave={() => saveKey('ollamaUrl', ollamaUrl)}
              placeholder="http://localhost:11434"
              saved={savedField === 'ollamaUrl'}
              secret={false}
            />
          </div>
        </div>

        <div>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: fg[3], marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${border[1]}`,
          }}>
            Active Model
          </div>
          <p style={{ fontSize: 10, color: fg[3], margin: '0 0 10px', lineHeight: 1.5 }}>
            The model used for AI Chat, inline edit (Cmd+K), and ghost-text completion. Persisted across restarts.
          </p>
          <ModelSelector />
        </div>

        <div>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: fg[3], marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${border[1]}`,
          }}>
            Global Rules
          </div>
          <p style={{ fontSize: 10, color: fg[3], margin: '0 0 8px', lineHeight: 1.5 }}>
            Rules injected into every AI chat across all projects, before any project-level .lakoorarules. Use this for personal conventions you want everywhere (e.g. tone, preferred libraries, output format).
          </p>
          <div style={{ position: 'relative' }}>
            <textarea
              value={globalRulesDraft}
              onChange={(e) => { setGlobalRulesDraft(e.target.value); setGlobalRulesSaved(false) }}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); void saveGlobalRules() } }}
              placeholder={'# Example\nAlways explain trade-offs before recommending an approach.\nPrefer concise answers over exhaustive ones.'}
              rows={6}
              style={{
                width: '100%',
                background: surface.raised,
                border: `1px solid ${border[0]}`,
                borderRadius: 4,
                padding: '8px 10px',
                fontSize: 11,
                color: fg[0],
                fontFamily: 'monospace',
                lineHeight: 1.6,
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
            <button
              type="button"
              onClick={saveGlobalRules}
              disabled={globalRulesSaving}
              title="Save Global Rules (⌘S)"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 10px',
                fontSize: 10,
                fontWeight: 600,
                borderRadius: 4,
                border: `1px solid ${globalRulesSaved ? accent.green.border : border[0]}`,
                background: globalRulesSaved ? accent.green.subtle : surface.raised,
                color: globalRulesSaved ? accent.green.fg : fg[2],
                cursor: !globalRulesSaving ? 'pointer' : 'not-allowed',
              }}
            >
              <Save size={10} />
              {globalRulesSaving ? 'Saving…' : globalRulesSaved ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>

        <div>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: fg[3], marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${border[1]}`,
          }}>
            Project Rules (.lakoorarules)
          </div>
          <p style={{ fontSize: 10, color: fg[3], margin: '0 0 8px', lineHeight: 1.5 }}>
            Rules injected as system context into every AI chat. Use plain text or Markdown to describe coding conventions, naming rules, or domain constraints.
            {!projectPath && <span style={{ color: accent.amber.fg }}> Open a project to edit.</span>}
          </p>
          <div style={{ position: 'relative' }}>
            <textarea
              value={rules}
              onChange={(e) => { setRules(e.target.value); setRulesSaved(false) }}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); void saveRules() } }}
              disabled={!projectPath}
              placeholder={'# Example\nAlways use TypeScript strict mode.\nPrefer named exports over default exports.\nUse functional components only.'}
              rows={8}
              style={{
                width: '100%',
                background: surface.raised,
                border: `1px solid ${border[0]}`,
                borderRadius: 4,
                padding: '8px 10px',
                fontSize: 11,
                color: fg[0],
                fontFamily: 'monospace',
                lineHeight: 1.6,
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box',
                opacity: projectPath ? 1 : 0.5,
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
            <button
              type="button"
              onClick={saveRules}
              disabled={!projectPath || rulesSaving}
              title="Save .lakoorarules (⌘S)"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 10px',
                fontSize: 10,
                fontWeight: 600,
                borderRadius: 4,
                border: `1px solid ${rulesSaved ? accent.green.border : border[0]}`,
                background: rulesSaved ? accent.green.subtle : surface.raised,
                color: rulesSaved ? accent.green.fg : fg[2],
                cursor: projectPath && !rulesSaving ? 'pointer' : 'not-allowed',
              }}
            >
              <Save size={10} />
              {rulesSaving ? 'Saving…' : rulesSaved ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>

        <div>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: fg[3], marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${border[1]}`,
          }}>
            Engine Health
          </div>

          <Button variant="ghost" size="sm" disabled={checking} onClick={checkAll}>
            {checking ? 'Checking…' : 'Check Engine'}
          </Button>

          {engine && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
              <StatusRow label="Repo root" ok detail={engine.repoRoot} />
              <StatusRow label="Python (.venv)" ok={engine.pythonFound} />
              <StatusRow label="pytest (.venv)" ok={engine.pytestFound} />
              <StatusRow label="ruff (.venv)" ok={engine.ruffFound} />
            </div>
          )}
        </div>

        <div>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: fg[3], marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${border[1]}`,
          }}>
            Python Bridge
          </div>
          <p style={{ fontSize: 10, color: fg[3], margin: '0 0 8px', lineHeight: 1.5 }}>
            Proves the subprocess bridge that Memory, Search, and Task Planner panels
            will reuse — calls <code style={{ fontFamily: 'monospace' }}>decision_analytics.py --json</code> directly.
          </p>

          {bridge && (
            <div style={{
              padding: '8px 10px', borderRadius: 4,
              background: bridge.ok ? accent.green.subtle : accent.red.subtle,
              border: `1px solid ${bridge.ok ? accent.green.border : accent.red.border}`,
              fontSize: 11, color: bridge.ok ? accent.green.fg : accent.red.fg,
            }}>
              {bridge.ok
                ? `Python bridge OK · ${(bridge.stats as { total?: number } | undefined)?.total ?? 0} cycles reported`
                : `Python bridge failed: ${bridge.error}`}
            </div>
          )}
        </div>

        <PolicySection />

        <CacheSection />

        <McpServersSection />

        {recentProjects.length > 0 && (
          <div>
            <div style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
              color: fg[3], marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${border[1]}`,
            }}>
              Recent Projects
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {recentProjects.slice(0, 5).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={async () => {
                    await saveSettings({ projectPath: p })
                    toast.success(`Switched to ${p.split('/').pop()}`)
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    background: surface.raised, border: `1px solid ${border[1]}`,
                    borderRadius: 4, padding: '5px 8px', cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <FolderOpen size={11} color={accent.amber.fg} style={{ flexShrink: 0 }} />
                  <span style={{
                    fontSize: 10, color: fg[1],
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {p}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{
          marginTop: 'auto', paddingTop: 12, borderTop: `1px solid ${border[1]}`,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={async () => {
                const path = await window.api.settings.exportSettings()
                if (path) toast.success(`Exported to ${path.split('/').pop()}`)
              }}
              style={{
                flex: 1, fontSize: 10, padding: '5px 0', borderRadius: 4,
                background: surface.raised, border: `1px solid ${border[0]}`,
                color: fg[2], cursor: 'pointer',
              }}
            >
              Export Settings
            </button>
            <button
              type="button"
              onClick={async () => {
                const keys = await window.api.settings.importSettings()
                if (keys) toast.success(`Imported ${keys.length} settings`)
                else toast.error('Import failed or cancelled')
              }}
              style={{
                flex: 1, fontSize: 10, padding: '5px 0', borderRadius: 4,
                background: surface.raised, border: `1px solid ${border[0]}`,
                color: fg[2], cursor: 'pointer',
              }}
            >
              Import Settings
            </button>
          </div>
          <div style={{ fontSize: 9, color: fg[4], textAlign: 'center' }}>
            Lakoora v0.1.0 · Phase A
          </div>
        </div>
      </div>
    </div>
  )
}
