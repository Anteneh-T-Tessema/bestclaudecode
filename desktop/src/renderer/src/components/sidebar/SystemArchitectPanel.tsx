import { useState } from 'react'
import { Network, Cpu, ListTodo } from 'lucide-react'
import { toast } from '../../store/useToastStore'
import { useChatStore, MODELS } from '../../store/useChatStore'
import { useAppStore } from '../../store/useAppStore'
import { PanelHeader, accent, border, fg, surface } from '../../design'

// Adapted from designer.js in github.com/Anteneh-T-Tessema/AIDesignPatterns —
// the catalog + architect prompt are the genuinely portable, model-agnostic
// part of that project (no pattern-selection code exists there at all; it's
// entirely delegated to the model via this one prompt). Kept verbatim where
// reasonable rather than rewritten, since it's already proven content.
const PATTERNS_CATALOG = `Available Agentic Design Patterns:
1. Prompt Chaining: Sequential execution steps with context handoffs.
2. Routing: Dynamic classification and branching to handlers.
3. Parallelization: Concurrently running agent tasks and voting/consensus.
4. Reasoning (Tree-of-Thoughts): Non-linear branch search and backtracking.
5. Planning (Plan-and-Execute): Decomposing high-level tasks into dynamic sub-steps.
6. Reflection (Self-Correction): Multi-step output critiquing and self-refinement.
7. Tool Use & Verification: Executing external tools and verifying schema safety.
8. Model Context Protocol (MCP): Standardizing access to remote servers and file resources.
9. Human-in-the-Loop (HITL): Interweaving human approvals/inputs into loops.
10. Prioritization: Urgency mapping and task manager backlog priority routing.
11. Memory: Semantic memory retrievals, short/long-term context caching.
12. Goal Monitoring: Running safety checkers to detect plan drift and dynamically replanning.
13. Resource-Aware Execution: Imposing token limit budgets and computational thresholds.
14. Multi-Agent Collaboration: Specialized role communication (Researcher -> Writer -> Editor).
15. Exploration & Discovery: Open-ended research loop (Generate -> Review -> Tournament -> Evolve -> Professor).
16. Agent-to-Agent (A2A): Message buses and protocols for decentralized peer-to-peer helper handoffs.
17. Guardrails & Policy: Input pre-screening and output post-validation compliance audits.
18. Exception Handling: Retry mechanics, fallback models, and graceful degradation.
19. Evaluation & Monitoring: Trace telemetry, latency profiling, and metric evaluations.
20. Learning & Optimization: Dynamic prompt modification from system rewards.
21. Knowledge Retrieval (RAG): Document semantic retrieval using local vector indexing.`

function buildArchitectSystemPrompt(): string {
  return `You are a Principal AI System Architect.
Your task is to analyze the user's system description and requirements, select the most appropriate Agentic Design Patterns from the catalog, and generate an exceptionally detailed and professional implementation architecture blueprint.

**Catalog of Available Design Patterns:**
${PATTERNS_CATALOG}

Respond with a comprehensive system architecture blueprint in Markdown. Focus on creating a publication-quality reference design. Do not make generic recommendations; name specific patterns and describe exactly how they will interact.

Include the following sections:

# AI Agent System Blueprint: [Descriptive System Title]

## 1. Executive Design Summary
- High-level summary of the system.
- Recommended Design Patterns and the detailed technical rationale for choosing them.

## 2. Agent Architecture & Choreography (ASCII Diagram)
- A clear, structured ASCII sequence diagram or flowchart showing how agents, routers, tools, and the user interact.
- Detail the path of data flow.

## 3. Specialized Agent Personas & Specifications
- List the specific agent personas required (e.g. Router, Planner, Reviewer, etc.) as a Markdown list, each with one short paragraph naming its system instructions, input/output format, and required tools.

## 4. Prompt Engineering Templates
- Write actual, production-ready system prompt templates for the key agents suggested above, each in its own fenced code block.

## 5. Reliability, Security & Budget Recommendations
- Describe how Exception Handling, Guardrails, or Resource-Aware Execution should be set up to ensure the system is stable and cost-efficient.`
}

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

/** Minimal Markdown rendering scoped to what an architect blueprint actually contains: headers, fenced code blocks (ASCII diagrams + prompt templates), and plain prose. Not a general-purpose renderer — mirrors ChatMessage.tsx's scope, kept local since that one isn't exported. */
function renderBlueprint(text: string): React.ReactNode[] {
  const parts = text.split(/(```[\s\S]*?```)/g)
  return parts.map((part, i) => {
    if (part.startsWith('```')) {
      const match = part.match(/^```(\w+)?\n?([\s\S]*?)```$/)
      const code = match ? match[2] : part.slice(3, -3)
      return (
        <pre key={i} style={{
          background: surface.void, border: `1px solid ${border[1]}`, borderRadius: 6,
          padding: '10px 12px', margin: '8px 0', overflowX: 'auto', fontSize: 11,
          fontFamily: 'monospace', color: fg[0], whiteSpace: 'pre',
        }}>
          {code}
        </pre>
      )
    }
    return (
      <div key={i}>
        {part.split('\n').map((line, j) => {
          const heading = line.match(/^(#{1,3})\s+(.*)/)
          if (heading) {
            const size = heading[1].length === 1 ? 14 : heading[1].length === 2 ? 12.5 : 11.5
            return <div key={j} style={{ fontSize: size, fontWeight: 700, color: fg[0], margin: '10px 0 4px' }}>{heading[2]}</div>
          }
          return <div key={j} style={{ fontSize: 11.5, color: fg[1], lineHeight: 1.5 }}>{line || ' '}</div>
        })}
      </div>
    )
  })
}

export function SystemArchitectPanel() {
  const [description, setDescription] = useState('')
  const [generating, setGenerating] = useState(false)
  const [blueprint, setBlueprint] = useState('')
  const activeModel = useChatStore((s) => s.activeModel)
  const setActiveModel = useChatStore((s) => s.setActiveModel)
  const setActiveActivity = useAppStore((s) => s.setActiveActivity)
  const setPendingIdeaSeed = useAppStore((s) => s.setPendingIdeaSeed)

  const generate = async () => {
    if (!description.trim() || generating) return
    setGenerating(true)
    setBlueprint('')
    try {
      const streamId = await window.api.ai.streamChat({
        messages: [{ role: 'user', content: description.trim() }],
        model: activeModel,
        systemPrompt: buildArchitectSystemPrompt(),
      })
      await new Promise<void>((resolve, reject) => {
        const unChunk = window.api.ai.onChunk(streamId, (d) => setBlueprint((prev) => prev + d))
        const unDone = window.api.ai.onDone(streamId, () => { unChunk(); unDone(); unErr(); resolve() })
        const unErr = window.api.ai.onError(streamId, (e) => { unChunk(); unDone(); unErr(); reject(new Error(e)) })
      })
    } catch (err) {
      toast.error(`Blueprint generation failed: ${(err as Error).message}`)
    } finally {
      setGenerating(false)
    }
  }

  const sendToIdeation = () => {
    if (!blueprint.trim()) return
    setPendingIdeaSeed(blueprint.trim())
    setActiveActivity('ideation')
    toast.success('Blueprint sent to Ideation — review it as the "Rough idea" before drafting a spec')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PanelHeader icon={<Network style={{ width: 13, height: 13, color: accent.violet.fg }} />} label="System Architect" />

      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={labelStyle()}>Model</label>
          <select
            value={activeModel}
            onChange={(e) => setActiveModel(e.target.value as typeof activeModel)}
            style={{
              ...fieldStyle(), resize: 'none', cursor: 'pointer', appearance: 'none', paddingRight: 24,
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
            }}
          >
            {MODELS.filter((m) => m.id !== 'auto' && m.id !== 'custom' && m.id !== 'ollama').map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle()}>Describe the agent system you want</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="e.g. An agent system that receives customer tickets, checks if they are spam, retrieves answers from a knowledge base, and drafts responses."
            style={fieldStyle()}
          />
          <button
            type="button"
            data-testid="generate-blueprint-button"
            onClick={() => void generate()}
            disabled={!description.trim() || generating}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, marginTop: 6,
              fontSize: 10.5, fontWeight: 700, padding: '5px 10px', borderRadius: 4,
              border: `1px solid ${accent.violet.border}`, background: accent.violet.subtle, color: accent.violet.fg,
              cursor: !description.trim() || generating ? 'not-allowed' : 'pointer',
              opacity: !description.trim() || generating ? 0.5 : 1,
            }}
          >
            <Cpu size={11} /> {generating ? 'Designing…' : 'Generate System Design'}
          </button>
        </div>

        {(blueprint || generating) && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <label style={{ ...labelStyle(), marginBottom: 0 }}>Blueprint</label>
              {blueprint && !generating && (
                <button
                  type="button"
                  onClick={sendToIdeation}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4, fontSize: 9.5, fontWeight: 700,
                    padding: '3px 8px', borderRadius: 4, border: `1px solid ${accent.amber.border}`,
                    background: accent.amber.subtle, color: accent.amber.fg, cursor: 'pointer',
                  }}
                >
                  <ListTodo size={10} /> Generate Plan from this blueprint
                </button>
              )}
            </div>
            <div style={{
              background: surface.void, border: `1px solid ${border[1]}`, borderRadius: 6,
              padding: '10px 12px', maxHeight: 420, overflowY: 'auto',
            }}>
              {blueprint ? renderBlueprint(blueprint) : (
                <div style={{ fontSize: 11, color: fg[3] }}>Analyzing patterns and synthesizing blueprint…</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
