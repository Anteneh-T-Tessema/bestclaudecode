import { useState, useCallback, useEffect, useRef } from 'react'
import { Settings, Circle, Eye, EyeOff, Check, FolderOpen, Save } from 'lucide-react'
import { PanelHeader, Button, accent, border, fg, surface } from '../../design'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useChatStore } from '../../store/useChatStore'
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

// Gap 88 — these three are encrypted via safeStorage (settings:setSecret), not the plain settings:set channel.
const SECRET_FIELDS = new Set(['anthropicApiKey', 'openaiApiKey', 'googleApiKey', 'groqApiKey', 'openrouterApiKey', 'linearApiKey', 'jiraApiToken', 'slackWebhookUrl', 'webhookSecret'])

export function SettingsPanel() {
  const [engine, setEngine] = useState<EngineHealth | null>(null)
  const [bridge, setBridge] = useState<BridgeResult | null>(null)
  const [checking, setChecking] = useState(false)

  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const storeOllamaUrl = useSettingsStore((s) => s.ollamaUrl)
  const recentProjects = useSettingsStore((s) => s.recentProjects)
  const projectPath = useSettingsStore((s) => s.projectPath)
  const storeGlobalRules = useSettingsStore((s) => s.globalRules)
  const saveSettings = useSettingsStore((s) => s.save)

  const activeModel = useChatStore((s) => s.activeModel)
  const hitlSandboxPromote = useSettingsStore((s) => s.hitlSandboxPromote)
  const hitlCommandRun = useSettingsStore((s) => s.hitlCommandRun)
  const hitlFileEdit = useSettingsStore((s) => s.hitlFileEdit)
  const hitlDeployment = useSettingsStore((s) => s.hitlDeployment)
  const storeCustomModelName = useSettingsStore((s) => s.customModelName)
  const storeCustomModelProvider = useSettingsStore((s) => s.customModelProvider)
  const useSandboxExec = useSettingsStore((s) => s.useSandboxExec)
  const dockerSandboxImage = useSettingsStore((s) => s.dockerSandboxImage)
  const storeUseLocalEmbeddings = useSettingsStore((s) => s.useLocalEmbeddings)
  const storeLocalEmbeddingModel = useSettingsStore((s) => s.localEmbeddingModel)

  const [customModelName, setCustomModelName] = useState('')
  const [customModelProvider, setCustomModelProvider] = useState<'anthropic' | 'openai' | 'google' | 'ollama'>('anthropic')

  const [useLocalEmbeddings, setUseLocalEmbeddings] = useState(false)
  const [localEmbeddingModel, setLocalEmbeddingModel] = useState('nomic-embed-text')

  const [anthropicKey, setAnthropicKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [googleKey, setGoogleKey] = useState('')
  const [groqKey, setGroqKey] = useState('')
  const [openrouterKey, setOpenrouterKey] = useState('')
  const [ollamaUrl, setOllamaUrl] = useState('')
  const [ollamaModel, setOllamaModel] = useState('llama3.2')
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [linearApiKey, setLinearApiKey] = useState('')
  const [jiraApiToken, setJiraApiToken] = useState('')
  const [jiraEmail, setJiraEmail] = useState('')
  const [jiraBaseUrl, setJiraBaseUrl] = useState('')
  const [slackWebhookUrl, setSlackWebhookUrl] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [webhookPort, setWebhookPort] = useState('7391')
  const [webhookStatus, setWebhookStatus] = useState<{ running: boolean; port: number } | null>(null)
  const [webhookBusy, setWebhookBusy] = useState(false)
  const [savedField, setSavedField] = useState<string | null>(null)

  // .meshflowrules editor
  const [rules, setRules] = useState('')
  const [rulesSaving, setRulesSaving] = useState(false)
  const [rulesSaved, setRulesSaved] = useState(false)
  const rulesLoadedFor = useRef<string | null>(null)

  // Global rules editor (cross-project, persisted via the settings store)
  const [globalRulesDraft, setGlobalRulesDraft] = useState('')
  const [globalRulesSaving, setGlobalRulesSaving] = useState(false)
  const [globalRulesSaved, setGlobalRulesSaved] = useState(false)
  const globalRulesLoaded = useRef(false)

  // Gap 88 — API keys are encrypted at rest (safeStorage) and loaded individually,
  // not via the bulk settings:getAll used for plain preferences.
  useEffect(() => {
    Promise.all([
      window.api.settings.getSecret('anthropicApiKey'),
      window.api.settings.getSecret('openaiApiKey'),
      window.api.settings.getSecret('googleApiKey'),
      window.api.settings.getSecret('groqApiKey'),
      window.api.settings.getSecret('openrouterApiKey'),
      window.api.settings.getSecret('linearApiKey'),
      window.api.settings.getSecret('jiraApiToken'),
      window.api.settings.getSecret('slackWebhookUrl'),
      window.api.settings.getSecret('webhookSecret'),
    ]).then(([a, o, g, groq, or_, lin, jir, slack, webhookSec]) => {
      setAnthropicKey(a)
      setOpenaiKey(o)
      setGoogleKey(g)
      setGroqKey(groq)
      setOpenrouterKey(or_)
      setLinearApiKey(lin)
      setJiraApiToken(jir)
      setSlackWebhookUrl(slack)
      setWebhookSecret(webhookSec)
    })
    window.api.settings.get('webhookPort').then((v) => { if (v) setWebhookPort(String(v)) }).catch(() => {})
    window.api.settings.get('ollamaModel').then((v) => { if (v) setOllamaModel(v as string) }).catch(() => {})
    window.api.webhook.status().then(setWebhookStatus).catch(() => {})
    // Pre-populate Ollama model list if Ollama is running locally
    window.api.ai.listOllamaModels().then((models) => { if (models.length) setOllamaModels(models) }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!settingsLoaded) return
    setOllamaUrl(storeOllamaUrl)
    setUseLocalEmbeddings(storeUseLocalEmbeddings)
    setLocalEmbeddingModel(storeLocalEmbeddingModel)
    if (!globalRulesLoaded.current) {
      setGlobalRulesDraft(storeGlobalRules)
      globalRulesLoaded.current = true
    }
    setCustomModelName(storeCustomModelName)
    setCustomModelProvider(storeCustomModelProvider)
    window.api.settings.get('jiraEmail').then((v) => { if (v) setJiraEmail(v as string) }).catch(() => {})
    window.api.settings.get('jiraBaseUrl').then((v) => { if (v) setJiraBaseUrl(v as string) }).catch(() => {})
  }, [settingsLoaded, storeOllamaUrl, storeGlobalRules, storeCustomModelName, storeCustomModelProvider, storeUseLocalEmbeddings, storeLocalEmbeddingModel])

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
    window.api.fs.readFile(`${projectPath}/.meshflowrules`)
      .then((content) => setRules(content ?? ''))
      .catch(() => setRules(''))
  }, [projectPath])

  const saveRules = async () => {
    if (!projectPath) return
    setRulesSaving(true)
    try {
      await window.api.fs.writeFile(`${projectPath}/.meshflowrules`, rules)
      setRulesSaved(true)
      setTimeout(() => setRulesSaved(false), 1500)
    } catch {
      toast.error('Failed to save .meshflowrules')
    } finally {
      setRulesSaving(false)
    }
  }

  const flashSaved = (field: string) => {
    setSavedField(field)
    setTimeout(() => setSavedField((f) => (f === field ? null : f)), 1500)
  }

  const saveKey = useCallback(
    async (field: 'anthropicApiKey' | 'openaiApiKey' | 'googleApiKey' | 'groqApiKey' | 'openrouterApiKey' | 'ollamaUrl' | 'ollamaModel' | 'linearApiKey' | 'jiraApiToken' | 'jiraEmail' | 'jiraBaseUrl' | 'slackWebhookUrl' | 'webhookSecret' | 'webhookPort' | 'customModelName' | 'customModelProvider' | 'localEmbeddingModel', value: string) => {
      if (SECRET_FIELDS.has(field)) {
        const result = await window.api.settings.setSecret(field, value)
        if (!result.success) { toast.error('Failed to save key'); return }
      } else {
        await saveSettings({ [field]: value })
      }
      toast.success('Saved')
      flashSaved(field)
    },
    [saveSettings]
  )

  const toggleWebhookServer = useCallback(async () => {
    setWebhookBusy(true)
    try {
      if (webhookStatus?.running) {
        await window.api.webhook.stop()
        setWebhookStatus((s) => (s ? { ...s, running: false } : s))
        toast.success('Webhook server stopped')
        return
      }
      await saveKey('webhookPort', webhookPort)
      const result = await window.api.webhook.start()
      if (result.success) {
        setWebhookStatus({ running: true, port: result.port ?? parseInt(webhookPort, 10) })
        toast.success(`Webhook server listening on port ${result.port}`)
      } else {
        toast.error(result.error ?? 'Failed to start webhook server')
      }
    } finally {
      setWebhookBusy(false)
    }
  }, [webhookStatus, webhookPort, saveKey])

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

  // Gap 94 — rebuild the semantic search index (src.chat_context --build-index),
  // surfaced here since file changes outside the IDE's own writes (git pull,
  // external editor) otherwise leave it stale with no visible way to refresh.
  const [rebuilding, setRebuilding] = useState(false)
  const [rebuildResult, setRebuildResult] = useState<{ indexed: number; backend: string } | null>(null)

  const rebuildIndex = useCallback(async () => {
    setRebuilding(true)
    setRebuildResult(null)
    try {
      const result = await window.api.search.buildIndex()
      setRebuildResult(result)
      toast.success(`Indexed ${result.indexed} file${result.indexed !== 1 ? 's' : ''}`)
    } catch {
      toast.error('Failed to rebuild search index')
    } finally {
      setRebuilding(false)
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
            Required for AI Chat and Cmd+K inline edit. Keys are encrypted at rest via your OS keychain, never sent anywhere but the provider you select.
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
              label="Groq API Key"
              value={groqKey}
              onChange={setGroqKey}
              onSave={() => saveKey('groqApiKey', groqKey)}
              onValidate={() => window.api.settings.validateKey('groq', groqKey)}
              placeholder="gsk_…"
              saved={savedField === 'groqApiKey'}
            />
            <ApiKeyField
              label="OpenRouter API Key"
              value={openrouterKey}
              onChange={setOpenrouterKey}
              onSave={() => saveKey('openrouterApiKey', openrouterKey)}
              onValidate={() => window.api.settings.validateKey('openrouter', openrouterKey)}
              placeholder="sk-or-…"
              saved={savedField === 'openrouterApiKey'}
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
            {/* Ollama model selector — populated by listing /api/tags */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10, color: fg[2], fontWeight: 600 }}>Ollama Model</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {ollamaModels.length > 0 ? (
                  <select
                    value={ollamaModel}
                    onChange={(e) => { setOllamaModel(e.target.value); void saveKey('ollamaModel', e.target.value) }}
                    style={{
                      flex: 1, background: surface.raised, border: `1px solid ${border[0]}`,
                      borderRadius: 4, padding: '4px 7px', fontSize: 11, color: fg[1],
                      outline: 'none', cursor: 'pointer',
                    }}
                  >
                    {ollamaModels.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : (
                  <input
                    value={ollamaModel}
                    onChange={(e) => setOllamaModel(e.target.value)}
                    onBlur={() => void saveKey('ollamaModel', ollamaModel)}
                    placeholder="llama3.2"
                    style={{
                      flex: 1, background: surface.raised, border: `1px solid ${border[0]}`,
                      borderRadius: 4, padding: '4px 7px', fontSize: 11, color: fg[1],
                      outline: 'none', fontFamily: 'monospace',
                    }}
                  />
                )}
                <button
                  type="button"
                  onClick={() => window.api.ai.listOllamaModels().then((ms) => { if (ms.length) setOllamaModels(ms) }).catch(() => {})}
                  style={{
                    fontSize: 10, padding: '4px 8px', borderRadius: 4,
                    background: surface.raised, border: `1px solid ${border[0]}`,
                    color: fg[2], cursor: 'pointer',
                  }}
                >
                  Refresh
                </button>
              </div>
              <span style={{ fontSize: 9, color: fg[4] }}>
                {ollamaModels.length > 0 ? `${ollamaModels.length} models found` : 'Start Ollama to auto-detect models, or type a name manually'}
              </span>
            </div>
          </div>
        </div>

        <div>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: fg[3], marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${border[1]}`,
          }}>
            Integrations
          </div>
          <p style={{ fontSize: 10, color: fg[3], margin: '0 0 10px', lineHeight: 1.5 }}>
            Connect Linear and Jira so @linear and @jira mentions inject issue context into your chat.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ApiKeyField
              label="Linear API Key"
              value={linearApiKey}
              onChange={setLinearApiKey}
              onSave={() => saveKey('linearApiKey', linearApiKey)}
              placeholder="lin_api_…"
              saved={savedField === 'linearApiKey'}
            />
            <ApiKeyField
              label="Jira API Token"
              value={jiraApiToken}
              onChange={setJiraApiToken}
              onSave={() => saveKey('jiraApiToken', jiraApiToken)}
              placeholder="ATATT3x…"
              saved={savedField === 'jiraApiToken'}
            />
            <ApiKeyField
              label="Jira Email"
              value={jiraEmail}
              onChange={setJiraEmail}
              onSave={() => saveKey('jiraEmail', jiraEmail)}
              placeholder="you@example.com"
              saved={savedField === 'jiraEmail'}
              secret={false}
            />
            <ApiKeyField
              label="Jira Base URL"
              value={jiraBaseUrl}
              onChange={setJiraBaseUrl}
              onSave={() => saveKey('jiraBaseUrl', jiraBaseUrl)}
              placeholder="https://your-org.atlassian.net"
              saved={savedField === 'jiraBaseUrl'}
              secret={false}
            />
          </div>
        </div>

        <div>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: fg[3], marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${border[1]}`,
          }}>
            Notifications
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ApiKeyField
              label="Slack Webhook URL"
              value={slackWebhookUrl}
              onChange={setSlackWebhookUrl}
              onSave={() => saveKey('slackWebhookUrl', slackWebhookUrl)}
              placeholder="https://hooks.slack.com/services/…"
              saved={savedField === 'slackWebhookUrl'}
              secret={true}
            />
          </div>
        </div>

        <div>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: fg[3], marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${border[1]}`,
          }}>
            Webhooks
          </div>
          <p style={{ fontSize: 10, color: fg[3], margin: '0 0 10px', lineHeight: 1.5 }}>
            Accept inbound Slack slash commands (POST /webhook/slack) and GitHub PR-opened
            events (POST /webhook/github) to trigger Meshflow agents. GET /health for status.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ApiKeyField
              label="Port"
              value={webhookPort}
              onChange={setWebhookPort}
              onSave={() => saveKey('webhookPort', webhookPort)}
              placeholder="7391"
              saved={savedField === 'webhookPort'}
              secret={false}
            />
            <ApiKeyField
              label="Shared Secret (optional, sent as X-Meshflow-Secret)"
              value={webhookSecret}
              onChange={setWebhookSecret}
              onSave={() => saveKey('webhookSecret', webhookSecret)}
              placeholder="leave blank to accept unauthenticated requests"
              saved={savedField === 'webhookSecret'}
              secret={true}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Button variant="ghost" disabled={webhookBusy} onClick={toggleWebhookServer}>
                {webhookStatus?.running ? 'Stop Server' : 'Start Server'}
              </Button>
              <span style={{ fontSize: 10, fontWeight: 600, color: webhookStatus?.running ? accent.green.fg : fg[3] }}>
                {webhookStatus?.running ? `● Listening on :${webhookStatus.port}` : '○ Stopped'}
              </span>
            </div>
          </div>
        </div>

        <div>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: fg[3], marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${border[1]}`,
          }}>
            APM Webhooks
          </div>
          <p style={{ fontSize: 10, color: fg[3], margin: '0 0 10px', lineHeight: 1.5 }}>
            Configure Sentry/Datadog to POST alerts to these URLs. Matching errors auto-trigger the self-healing agent.
            Requires the webhook server to be running (see Webhooks section above).
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { label: 'Sentry Webhook URL', path: '/webhook/sentry' },
              { label: 'Datadog Webhook URL', path: '/webhook/datadog' },
            ].map(({ label, path }) => (
              <div key={path} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <label style={{ fontSize: 10, color: fg[2], fontWeight: 600 }}>{label}</label>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: surface.raised, border: `1px solid ${border[0]}`,
                  borderRadius: 4, padding: '5px 8px',
                }}>
                  <span style={{ fontSize: 10, color: fg[1], fontFamily: 'monospace', flex: 1, userSelect: 'all' }}>
                    {webhookStatus?.running
                      ? `http://localhost:${webhookStatus.port}${path}`
                      : `http://localhost:7391${path} (server stopped)`}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const port = webhookStatus?.port ?? 7391
                      navigator.clipboard.writeText(`http://localhost:${port}${path}`)
                    }}
                    style={{
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: fg[4], fontSize: 10, padding: '1px 4px',
                    }}
                    title="Copy URL"
                  >
                    Copy
                  </button>
                </div>
              </div>
            ))}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ModelSelector />
            {activeModel === 'custom' && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                marginTop: 4,
                padding: 10,
                borderRadius: 6,
                background: surface.surface,
                border: `1px solid ${border[0]}`
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: fg[1] }}>Custom Model Configuration</div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 9, color: fg[2], fontWeight: 600 }}>Custom Model ID / Name</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      value={customModelName}
                      onChange={(e) => setCustomModelName(e.target.value)}
                      placeholder="e.g. gemini-2.5-pro, deepseek-coder"
                      style={{
                        flex: 1,
                        background: surface.raised,
                        border: `1px solid ${border[0]}`,
                        borderRadius: 4,
                        padding: '5px 8px',
                        fontSize: 11,
                        color: fg[0],
                        outline: 'none'
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => saveKey('customModelName', customModelName)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '0 12px',
                        fontSize: 10,
                        fontWeight: 600,
                        borderRadius: 4,
                        border: `1px solid ${savedField === 'customModelName' ? accent.green.border : border[0]}`,
                        background: savedField === 'customModelName' ? accent.green.subtle : surface.raised,
                        color: savedField === 'customModelName' ? accent.green.fg : fg[2],
                        cursor: 'pointer'
                      }}
                    >
                      {savedField === 'customModelName' ? 'Saved' : 'Save'}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 9, color: fg[2], fontWeight: 600 }}>Custom Model Provider</label>
                  <select
                    value={customModelProvider}
                    onChange={(e) => {
                      const prov = e.target.value as 'anthropic' | 'openai' | 'google' | 'ollama'
                      setCustomModelProvider(prov)
                      void saveKey('customModelProvider', prov)
                    }}
                    style={{
                      width: '100%',
                      background: surface.raised,
                      border: `1px solid ${border[0]}`,
                      borderRadius: 4,
                      padding: '5px 8px',
                      fontSize: 11,
                      color: fg[0],
                      outline: 'none'
                    }}
                  >
                    <option value="anthropic">Anthropic</option>
                    <option value="openai">OpenAI</option>
                    <option value="google">Google Gemini</option>
                    <option value="ollama">Ollama (Local)</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>

        <div>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: fg[3], marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${border[1]}`,
          }}>
            Governance & HITL Safety Controls
          </div>
          <p style={{ fontSize: 10, color: fg[3], margin: '0 0 10px', lineHeight: 1.5 }}>
            Configure constraints and approval gates for the autonomous agent's actions across SDLC phases.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 10, color: fg[1], fontWeight: 600 }}>Worktree Changes (File Mutations)</label>
              <select
                value={hitlFileEdit}
                onChange={async (e) => {
                  await saveSettings({ hitlFileEdit: e.target.value as 'sandbox' | 'always' })
                  toast.success('Worktree isolation setting updated')
                }}
                style={{
                  width: '100%', background: surface.raised, border: `1px solid ${border[0]}`,
                  borderRadius: 4, padding: '5px 8px', fontSize: 11, color: fg[0], outline: 'none'
                }}
              >
                <option value="sandbox">Isolate in Sandboxed Worktree (Recommended)</option>
                <option value="always">Apply directly to Codebase</option>
              </select>
              <span style={{ fontSize: 9, color: fg[3], lineHeight: 1.3 }}>
                Isolates file changes in a separate worktree branch for safe execution and review, or mutates the workspace files immediately.
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 10, color: fg[1], fontWeight: 600 }}>Automation Level (Sandbox Promotion)</label>
              <select
                value={hitlSandboxPromote}
                onChange={async (e) => {
                  await saveSettings({ hitlSandboxPromote: e.target.value as 'review' | 'always' })
                  toast.success('Sandbox promotion setting updated')
                }}
                style={{
                  width: '100%', background: surface.raised, border: `1px solid ${border[0]}`,
                  borderRadius: 4, padding: '5px 8px', fontSize: 11, color: fg[0], outline: 'none'
                }}
              >
                <option value="review">Interactive Diff Review (Recommended)</option>
                <option value="always">Zero-Click Auto-Promote on green tests</option>
              </select>
              <span style={{ fontSize: 9, color: fg[3], lineHeight: 1.3 }}>
                Determines whether sandboxed branch modifications are merged automatically on success, or left for manual review.
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 10, color: fg[1], fontWeight: 600 }}>Tool Runs (Command Execution)</label>
              <select
                value={hitlCommandRun}
                onChange={async (e) => {
                  await saveSettings({ hitlCommandRun: e.target.value as 'policy' | 'always' | 'never' })
                  toast.success('Command run policy updated')
                }}
                style={{
                  width: '100%', background: surface.raised, border: `1px solid ${border[0]}`,
                  borderRadius: 4, padding: '5px 8px', fontSize: 11, color: fg[0], outline: 'none'
                }}
              >
                <option value="policy">Rule-based Policies (Recommended)</option>
                <option value="always">Always Auto-Run commands</option>
                <option value="never">Prompt for Every Command</option>
              </select>
              <span style={{ fontSize: 9, color: fg[3], lineHeight: 1.3 }}>
                Governs whether command execution requires user confirmation, follows safety rules, or prompts for every action.
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 10, color: fg[1], fontWeight: 600 }}>Deploy Gate (Deployment releases)</label>
              <select
                value={hitlDeployment}
                onChange={async (e) => {
                  await saveSettings({ hitlDeployment: e.target.value as 'confirm' | 'always' })
                  toast.success('Deploy gate updated')
                }}
                style={{
                  width: '100%', background: surface.raised, border: `1px solid ${border[0]}`,
                  borderRadius: 4, padding: '5px 8px', fontSize: 11, color: fg[0], outline: 'none'
                }}
              >
                <option value="confirm">Confirm before release (Recommended)</option>
                <option value="always">Immediate Deploy</option>
              </select>
              <span style={{ fontSize: 9, color: fg[3], lineHeight: 1.3 }}>
                Requires native prompt validation before code is packaged and pushed, or allows instant headless deployment.
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 10, color: fg[1], fontWeight: 600 }}>Command Sandbox</label>
              <select
                data-testid="sandbox-mode-select"
                value={useSandboxExec}
                onChange={async (e) => {
                  await saveSettings({ useSandboxExec: e.target.value as 'never' | 'no-network' | 'restrict-write' | 'docker' })
                  toast.success('Sandbox execution mode updated')
                }}
                style={{
                  width: '100%', background: surface.raised, border: `1px solid ${border[0]}`,
                  borderRadius: 4, padding: '5px 8px', fontSize: 11, color: fg[0], outline: 'none'
                }}
              >
                <option value="never">Disabled (Run natively on host)</option>
                <option value="restrict-write">Restrict Writes — macOS only (Block writes outside project)</option>
                <option value="no-network">Isolated Sandbox — macOS only (No Network & Restrict Writes)</option>
                <option value="docker">Docker Container (Recommended) — full filesystem/process isolation</option>
              </select>
              <span style={{ fontSize: 9, color: fg[3], lineHeight: 1.3 }}>
                {useSandboxExec === 'docker'
                  ? 'Runs each agent command in a disposable container that can only see the project directory — no access to your home folder, SSH keys, or other repos. Requires Docker to be installed and running; commands fail clearly (not silently unsandboxed) if it isn’t.'
                  : 'Restrict Writes / Isolated Sandbox use macOS’s native sandbox-exec (ambient permission restriction on this same host process) and are unavailable on other platforms. Docker is the cross-platform, stronger-isolation option.'}
              </span>
            </div>

            {useSandboxExec === 'docker' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 10, color: fg[1], fontWeight: 600 }}>Docker Sandbox Image</label>
                <input
                  value={dockerSandboxImage}
                  onChange={(e) => void saveSettings({ dockerSandboxImage: e.target.value })}
                  placeholder="node:22-bookworm"
                  style={{
                    width: '100%', boxSizing: 'border-box', background: surface.raised, border: `1px solid ${border[0]}`,
                    borderRadius: 4, padding: '5px 8px', fontSize: 11, color: fg[0], outline: 'none', fontFamily: 'monospace',
                  }}
                />
                <span style={{ fontSize: 9, color: fg[3], lineHeight: 1.3 }}>
                  Pulled automatically on first use. Pick an image with the tools your agent's commands need (npm/pytest/git, etc.) — commands that need a tool missing from the image will fail with a normal non-zero exit, same as a missing tool on the host.
                </span>
              </div>
            )}
          </div>
        </div>

        <div>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: fg[3], marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${border[1]}`,
          }}>
            Global Rules
          </div>
          <p style={{ fontSize: 10, color: fg[3], margin: '0 0 8px', lineHeight: 1.5 }}>
            Rules injected into every AI chat across all projects, before any project-level .meshflowrules. Use this for personal conventions you want everywhere (e.g. tone, preferred libraries, output format).
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
            Project Rules (.meshflowrules)
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
              title="Save .meshflowrules (⌘S)"
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

        <div>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: fg[3], marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${border[1]}`,
          }}>
            Search Index
          </div>
          <p style={{ fontSize: 10, color: fg[3], margin: '0 0 8px', lineHeight: 1.5 }}>
            Powers @codebase and the automatic retrieval baseline. Rebuild after pulling
            changes made outside the IDE, or if search results feel stale.
          </p>

          <Button variant="ghost" size="sm" disabled={rebuilding} onClick={rebuildIndex}>
            {rebuilding ? 'Rebuilding…' : 'Rebuild Search Index'}
          </Button>

          {rebuildResult && (
            <div style={{ marginTop: 8 }}>
              <StatusRow
                label="Indexed"
                ok={rebuildResult.indexed > 0}
                detail={`${rebuildResult.indexed} files · ${rebuildResult.backend || 'unknown backend'}`}
              />
            </div>
          )}
        </div>

        <div>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: fg[3], marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${border[1]}`,
          }}>
            Local Embeddings (Ollama)
          </div>
          <p style={{ fontSize: 10, color: fg[3], margin: '0 0 10px', lineHeight: 1.5 }}>
            Configure local, offline-first embeddings using Ollama rather than Voyage AI or hashing fallbacks.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 9, color: fg[2], fontWeight: 600 }}>Embedding Provider</label>
              <select
                value={useLocalEmbeddings ? 'ollama' : 'default'}
                onChange={async (e) => {
                  const val = e.target.value === 'ollama'
                  await saveSettings({ useLocalEmbeddings: val })
                  toast.success(`Embeddings switched to ${val ? 'Ollama' : 'Voyage AI / Hash'}`)
                }}
                style={{
                  width: '100%', background: surface.raised, border: `1px solid ${border[0]}`,
                  borderRadius: 4, padding: '5px 8px', fontSize: 11, color: fg[0], outline: 'none'
                }}
              >
                <option value="default">Voyage AI / Deterministic Hash Fallback</option>
                <option value="ollama">Ollama (Local Offline-First)</option>
              </select>
            </div>

            {useLocalEmbeddings && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 9, color: fg[2], fontWeight: 600 }}>Local Embedding Model</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    value={localEmbeddingModel}
                    onChange={(e) => setLocalEmbeddingModel(e.target.value)}
                    placeholder="e.g. nomic-embed-text"
                    style={{
                      flex: 1,
                      background: surface.raised,
                      border: `1px solid ${border[0]}`,
                      borderRadius: 4,
                      padding: '5px 8px',
                      fontSize: 11,
                      color: fg[0],
                      outline: 'none'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => saveKey('localEmbeddingModel', localEmbeddingModel)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0 12px',
                      fontSize: 10,
                      fontWeight: 600,
                      borderRadius: 4,
                      border: `1px solid ${savedField === 'localEmbeddingModel' ? accent.green.border : border[0]}`,
                      background: savedField === 'localEmbeddingModel' ? accent.green.subtle : surface.raised,
                      color: savedField === 'localEmbeddingModel' ? accent.green.fg : fg[2],
                      cursor: 'pointer'
                    }}
                  >
                    {savedField === 'localEmbeddingModel' ? 'Saved' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
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
            Meshflow v0.1.0 · Phase A
          </div>
        </div>
      </div>
    </div>
  )
}
