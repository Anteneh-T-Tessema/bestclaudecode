import { useState, useEffect } from 'react'
import { Lightbulb, Sparkles, Plus, Trash2, ListTodo, RefreshCw, Wand2 } from 'lucide-react'
import { toast } from '../../store/useToastStore'
import { useChatStore, MODELS } from '../../store/useChatStore'
import { useAppStore } from '../../store/useAppStore'
import { PanelHeader, accent, border, fg, surface } from '../../design'

interface DraftSubtask { description: string }

interface Spec {
  goal: string
  problem: string
  scope: string
  openQuestions: string[]
  subtasks: DraftSubtask[]
}

const SPEC_SYSTEM_PROMPT = 'You are a product-minded engineering planner. Given a rough idea, respond ONLY with valid JSON matching this schema: {"goal": "one-line goal", "problem": "what problem this solves", "scope": "what is in/out of scope", "openQuestions": ["..."], "subtasks": [{"description": "specific, actionable implementation step"}]}. Produce 3-8 specific, concrete subtasks — not generic placeholders. No markdown fences, no commentary outside the JSON object.'

const REFINE_SYSTEM_PROMPT = 'You are a product-minded engineering planner. You are given an existing spec as JSON and user feedback. Revise the spec to incorporate the feedback precisely. Keep what is already good. Respond ONLY with valid JSON matching this schema: {"goal": "one-line goal", "problem": "what problem this solves", "scope": "what is in/out of scope", "openQuestions": ["..."], "subtasks": [{"description": "specific, actionable implementation step"}]}. No markdown fences, no commentary outside the JSON object.'

function fieldStyle(): React.CSSProperties {
  return {
    width: '100%', boxSizing: 'border-box', resize: 'vertical',
    background: surface.raised, border: `1px solid ${border[0]}`, borderRadius: 4,
    padding: '6px 8px', fontSize: 11, color: fg[0], outline: 'none', fontFamily: 'inherit',
  }
}

function labelStyle(): React.CSSProperties {
  return { fontSize: 10, color: fg[3], display: 'block', marginBottom: 4, fontWeight: 600 }
}

function helperTextStyle(): React.CSSProperties {
  return { fontSize: 9, color: fg[4], display: 'block', marginBottom: 6, lineHeight: 1.35 }
}

async function streamToText(streamId: string): Promise<string> {
  let text = ''
  await new Promise<void>((resolve, reject) => {
    const unChunk = window.api.ai.onChunk(streamId, (d) => { text += d })
    const unDone = window.api.ai.onDone(streamId, () => { unChunk(); unDone(); unErr(); resolve() })
    const unErr = window.api.ai.onError(streamId, (e) => { unChunk(); unDone(); unErr(); reject(new Error(e)) })
  })
  return text
}

function parseSpec(text: string, fallbackGoal: string): Spec {
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text) as Partial<Spec>
  return {
    goal: parsed.goal ?? fallbackGoal,
    problem: parsed.problem ?? '',
    scope: parsed.scope ?? '',
    openQuestions: parsed.openQuestions ?? [],
    subtasks: parsed.subtasks?.length ? parsed.subtasks : [{ description: '' }],
  }
}

export function IdeationPanel() {
  const [idea, setIdea] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [spec, setSpec] = useState<Spec | null>(null)
  const [creating, setCreating] = useState(false)
  const [refineText, setRefineText] = useState('')
  const [refining, setRefining] = useState(false)
  const [iteration, setIteration] = useState(0)
  const [componentPrompt, setComponentPrompt] = useState('')
  const [generatingComponent, setGeneratingComponent] = useState(false)
  const activeModel = useChatStore((s) => s.activeModel)
  const setActiveModel = useChatStore((s) => s.setActiveModel)
  const setActiveActivity = useAppStore((s) => s.setActiveActivity)
  const pendingIdeaSeed = useAppStore((s) => s.pendingIdeaSeed)
  const setPendingIdeaSeed = useAppStore((s) => s.setPendingIdeaSeed)

  // System Architect's "Generate Plan from this blueprint" hands off here via
  // useAppStore rather than the two panels sharing state directly — consumed
  // once on mount/whenever it changes, then cleared so revisiting Ideation
  // later doesn't keep re-seeding a stale blueprint.
  useEffect(() => {
    if (pendingIdeaSeed) {
      setIdea(pendingIdeaSeed)
      setPendingIdeaSeed(null)
    }
  }, [pendingIdeaSeed, setPendingIdeaSeed])

  // Zero-to-one scaffolding, first slice: builds a task description (prompt +
  // the project's existing design tokens) and hands it to the same
  // create-plan -> revise -> startAutonomous plumbing generatePlan() below
  // already uses — one component-scoped task, not a second write path.
  const generateComponent = async () => {
    if (!componentPrompt.trim() || generatingComponent) return
    setGeneratingComponent(true)
    try {
      const projectPath = (window.api.settings.get('projectPath') as unknown as string) ?? ''
      const result = await window.api.ideation.generateComponent(projectPath, componentPrompt.trim())
      if (!result) { toast.error('Component generation failed'); return }

      const goal = `Component: ${componentPrompt.trim()}`.slice(0, 80)
      const created = await window.api.taskPlanner.create(goal)
      if (!created) { toast.error('Failed to create plan'); return }
      const planFile = `plans/${created.slug}.json`
      const revised = await window.api.taskPlanner.revise(planFile, [
        { id: '01', description: result.taskDescription, depends_on: [], done: false },
      ])
      if (!revised) { toast.error('Plan created but failed to apply component task'); return }

      const sessionId = await window.api.agent.startAutonomous({ planFile, model: activeModel ?? 'claude-sonnet-4-6' })
      if (sessionId) {
        toast.success(`Component task started — agent session ${sessionId.slice(0, 8)}`)
        setActiveActivity('swarm')
      } else {
        toast.success('Component task created — open Task Planner to start it')
      }
      setComponentPrompt('')
    } finally {
      setGeneratingComponent(false)
    }
  }

  const draftSpec = async () => {
    if (!idea.trim() || drafting) return
    setDrafting(true)
    setSpec(null)
    setIteration(0)
    try {
      const streamId = await window.api.ai.streamChat({
        messages: [{ role: 'user', content: idea.trim() }],
        model: activeModel,
        systemPrompt: SPEC_SYSTEM_PROMPT,
      })
      const text = await streamToText(streamId)
      setSpec(parseSpec(text, idea.trim()))
    } catch (err) {
      toast.error(`Draft failed: ${(err as Error).message}`)
    } finally {
      setDrafting(false)
    }
  }

  const refineSpec = async () => {
    if (!spec || !refineText.trim() || refining) return
    setRefining(true)
    try {
      const currentSpecJson = JSON.stringify(spec, null, 2)
      const streamId = await window.api.ai.streamChat({
        messages: [
          {
            role: 'user',
            content: `Current spec:\n\`\`\`json\n${currentSpecJson}\n\`\`\`\n\nFeedback: ${refineText.trim()}`,
          },
        ],
        model: activeModel,
        systemPrompt: REFINE_SYSTEM_PROMPT,
      })
      const text = await streamToText(streamId)
      setSpec(parseSpec(text, spec.goal))
      setIteration((n) => n + 1)
      setRefineText('')
    } catch (err) {
      toast.error(`Refinement failed: ${(err as Error).message}`)
    } finally {
      setRefining(false)
    }
  }

  const updateSpec = <K extends keyof Spec>(field: K, value: Spec[K]) =>
    setSpec((prev) => (prev ? { ...prev, [field]: value } : prev))

  const updateSubtask = (idx: number, value: string) =>
    setSpec((prev) => prev ? { ...prev, subtasks: prev.subtasks.map((s, i) => i === idx ? { description: value } : s) } : prev)
  const removeSubtask = (idx: number) =>
    setSpec((prev) => prev ? { ...prev, subtasks: prev.subtasks.filter((_, i) => i !== idx) } : prev)
  const addSubtask = () =>
    setSpec((prev) => prev ? { ...prev, subtasks: [...prev.subtasks, { description: '' }] } : prev)

  const updateOpenQuestion = (idx: number, value: string) =>
    setSpec((prev) => prev ? { ...prev, openQuestions: prev.openQuestions.map((q, i) => i === idx ? value : q) } : prev)
  const removeOpenQuestion = (idx: number) =>
    setSpec((prev) => prev ? { ...prev, openQuestions: prev.openQuestions.filter((_, i) => i !== idx) } : prev)
  const addOpenQuestion = () =>
    setSpec((prev) => prev ? { ...prev, openQuestions: [...prev.openQuestions, ''] } : prev)

  const generatePlan = async () => {
    if (!spec || creating) return
    const subtasks = spec.subtasks.filter((s) => s.description.trim())
    if (subtasks.length === 0) { toast.error('At least one subtask is required'); return }
    setCreating(true)
    try {
      const created = await window.api.taskPlanner.create(spec.goal)
      if (!created) { toast.error('Failed to create plan'); return }
      const planFile = `plans/${created.slug}.json`
      const revisedSubtasks = subtasks.map((s, i) => ({
        id: String(i + 1).padStart(2, '0'), description: s.description.trim(), depends_on: [], done: false,
      }))
      const revised = await window.api.taskPlanner.revise(planFile, revisedSubtasks)
      if (!revised) { toast.error('Plan created but failed to apply drafted subtasks'); return }

      const specMarkdown = [
        `---`, `plan: ${planFile}`, `---`, '',
        `# ${spec.goal}`, '',
        `## Problem`, spec.problem, '',
        `## Scope`, spec.scope, '',
        `## Open Questions`,
        ...(spec.openQuestions.length ? spec.openQuestions.map((q) => `- ${q}`) : ['(none)']),
        '', `## Subtasks`,
        ...revisedSubtasks.map((s) => `- [${s.id}] ${s.description}`),
        '',
      ].join('\n')
      await window.api.ideation.saveSpec(created.slug, specMarkdown)

      // Swarm coordination — AI-drafted subtasks (unlike skeleton-plan
      // placeholders) usually classify into distinct roles (frontend/backend/
      // test/...) from their description alone. When more than one role is
      // present, launch one role-scoped session per role against the same
      // plan instead of a single generalist session, so e.g. frontend and
      // backend work actually proceed in parallel under their own agents.
      const model = activeModel ?? 'claude-sonnet-4-6'
      const roles = await window.api.agent.planRoles(planFile)
      const sessionIds = roles.length > 1
        ? (await Promise.all(roles.map((role) => window.api.agent.startAutonomous({ planFile, model, role })))).filter((id): id is string => !!id)
        : [await window.api.agent.startAutonomous({ planFile, model })].filter((id): id is string => !!id)

      if (sessionIds.length > 0) {
        toast.success(
          roles.length > 1
            ? `Plan created — ${sessionIds.length} role-scoped agents started (${roles.join(', ')})`
            : `Plan created — agent session ${sessionIds[0].slice(0, 8)} started`,
        )
        setActiveActivity('swarm')
      } else {
        toast.success('Plan created from spec — open Task Planner to start it')
      }
      setSpec(null)
      setIdea('')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PanelHeader icon={<Lightbulb style={{ width: 13, height: 13, color: accent.amber.fg }} />} label="Ideation" />

      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={labelStyle()}>Model</label>
          <select
            value={activeModel}
            onChange={(e) => setActiveModel(e.target.value as typeof activeModel)}
            style={{
              ...fieldStyle(),
              resize: 'none',
              cursor: 'pointer',
              appearance: 'none',
              paddingRight: 24,
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 8px center',
            }}
          >
            {MODELS.filter((m) => m.id !== 'auto' && m.id !== 'custom' && m.id !== 'ollama').map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        <div style={{ borderBottom: `1px solid ${border[1]}`, paddingBottom: 12 }}>
          <label style={labelStyle()}>Generate component</label>
          <span style={helperTextStyle()}>One prompt → one ready-to-build component, matching this project's existing design. For a multi-step feature, use "Rough idea" below instead.</span>
          <textarea
            value={componentPrompt}
            onChange={(e) => setComponentPrompt(e.target.value)}
            rows={2}
            placeholder="e.g. A pricing card with three tiers"
            style={fieldStyle()}
          />
          <button
            type="button"
            onClick={() => void generateComponent()}
            disabled={!componentPrompt.trim() || generatingComponent}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, marginTop: 6,
              fontSize: 10.5, fontWeight: 700, padding: '5px 10px', borderRadius: 4,
              border: `1px solid ${accent.cyan.border}`, background: accent.cyan.subtle, color: accent.cyan.fg,
              cursor: !componentPrompt.trim() || generatingComponent ? 'not-allowed' : 'pointer',
              opacity: !componentPrompt.trim() || generatingComponent ? 0.5 : 1,
            }}
          >
            <Wand2 size={11} /> {generatingComponent ? 'Generating…' : 'Generate Component'}
          </button>
        </div>

        <div>
          <label style={labelStyle()}>Rough idea</label>
          <span style={helperTextStyle()}>For anything bigger than one component — drafts a full spec (problem, scope, subtasks) you can review and edit before it becomes a plan.</span>
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            rows={3}
            placeholder="e.g. Build a todo app with auth and reminders"
            style={fieldStyle()}
          />
          <button
            type="button"
            onClick={() => void draftSpec()}
            disabled={!idea.trim() || drafting}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, marginTop: 6,
              fontSize: 10.5, fontWeight: 700, padding: '5px 10px', borderRadius: 4,
              border: `1px solid ${accent.violet.border}`, background: accent.violet.subtle, color: accent.violet.fg,
              cursor: !idea.trim() || drafting ? 'not-allowed' : 'pointer',
              opacity: !idea.trim() || drafting ? 0.5 : 1,
            }}
          >
            <Sparkles size={11} /> {drafting ? 'Drafting…' : 'Draft Spec'}
          </button>
        </div>

        {spec && (
          <>
            <div>
              <label style={labelStyle()}>Goal</label>
              <input
                value={spec.goal}
                onChange={(e) => updateSpec('goal', e.target.value)}
                style={fieldStyle()}
              />
            </div>
            <div>
              <label style={labelStyle()}>Problem</label>
              <textarea value={spec.problem} onChange={(e) => updateSpec('problem', e.target.value)} rows={2} style={fieldStyle()} />
            </div>
            <div>
              <label style={labelStyle()}>Scope</label>
              <textarea value={spec.scope} onChange={(e) => updateSpec('scope', e.target.value)} rows={2} style={fieldStyle()} />
            </div>

            <div>
              <label style={labelStyle()}>Open questions</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {spec.openQuestions.map((q, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 5 }}>
                    <input value={q} onChange={(e) => updateOpenQuestion(idx, e.target.value)} style={fieldStyle()} />
                    <button type="button" onClick={() => removeOpenQuestion(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg[4], display: 'flex' }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                <button
                  type="button" onClick={addOpenQuestion}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: fg[3], background: 'none', border: 'none', cursor: 'pointer', alignSelf: 'flex-start' }}
                >
                  <Plus size={11} /> Add question
                </button>
              </div>
            </div>

            <div>
              <label style={labelStyle()}>Subtasks ({spec.subtasks.length})</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {spec.subtasks.map((s, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 5 }}>
                    <input
                      value={s.description}
                      onChange={(e) => updateSubtask(idx, e.target.value)}
                      placeholder={`Subtask ${idx + 1}`}
                      style={fieldStyle()}
                    />
                    <button type="button" onClick={() => removeSubtask(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg[4], display: 'flex' }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                <button
                  type="button" onClick={addSubtask}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: fg[3], background: 'none', border: 'none', cursor: 'pointer', alignSelf: 'flex-start' }}
                >
                  <Plus size={11} /> Add subtask
                </button>
              </div>
            </div>

            {/* Refinement / iteration */}
            <div style={{ borderTop: `1px solid ${border[1]}`, paddingTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <label style={{ ...labelStyle(), marginBottom: 0 }}>Refine spec</label>
                {iteration > 0 && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                    color: accent.amber.fg, background: accent.amber.subtle, border: `1px solid ${accent.amber.border}`,
                    borderRadius: 3, padding: '1px 5px',
                  }}>
                    Round {iteration}
                  </span>
                )}
              </div>
              <textarea
                value={refineText}
                onChange={(e) => setRefineText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void refineSpec() } }}
                rows={2}
                placeholder="e.g. Make subtasks more concrete, remove UI tasks, focus on backend only…"
                style={fieldStyle()}
              />
              <button
                type="button"
                onClick={() => void refineSpec()}
                disabled={!refineText.trim() || refining}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, marginTop: 6,
                  fontSize: 10.5, fontWeight: 700, padding: '5px 10px', borderRadius: 4,
                  border: `1px solid ${accent.amber.border}`, background: accent.amber.subtle, color: accent.amber.fg,
                  cursor: !refineText.trim() || refining ? 'not-allowed' : 'pointer',
                  opacity: !refineText.trim() || refining ? 0.5 : 1,
                }}
              >
                <RefreshCw size={11} style={{ animation: refining ? 'spin 1s linear infinite' : 'none' }} />
                {refining ? 'Refining…' : 'Refine'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => void generatePlan()}
                disabled={creating}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700,
                  padding: '6px 12px', borderRadius: 4, border: `1px solid ${accent.green.border}`,
                  background: accent.green.subtle, color: accent.green.fg,
                  cursor: creating ? 'not-allowed' : 'pointer', opacity: creating ? 0.5 : 1,
                }}
              >
                <ListTodo size={11} /> {creating ? 'Generating…' : 'Generate Plan'}
              </button>
              <button
                type="button"
                onClick={() => setActiveActivity('tasks')}
                style={{
                  fontSize: 10.5, padding: '6px 12px', borderRadius: 4,
                  border: `1px solid ${border[0]}`, background: surface.raised, color: fg[2], cursor: 'pointer',
                }}
              >
                View in Task Planner →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
