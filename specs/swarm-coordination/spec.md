# Spec: Multi-role swarm coordination

## 1. Current state (verified against the code)

The only cross-agent primitive in the desktop app is
`desktop/src/main/agentHandoffStore.ts` — a flat in-memory `Map<string, string>`
with `setHandoff`/`getHandoff`/`listHandoffs`/`clearHandoff`, wired through
`ipc/handoff.handlers.ts` as four IPC calls. An agent writes a value under a
key via a `<<<HANDOFF>>>` block; another agent (or the renderer, via
`@handoff:<key>`) reads it back. That's the entire mechanism: 50 lines total,
no concept of *who* wrote a value, *what role* they were acting in, or
whether a second agent is even running concurrently.

There is no code anywhere in `desktop/src/main` that:
- launches more than one `autonomousAgent.ts` session against the same task
  with different role prompts (frontend / backend / security / etc.)
- assigns subtasks from a single `TaskPlan` to different agent roles
- lets one agent's output gate or trigger another's start
- aggregates multiple agents' policy evaluations or run reports into one view

So "swarm" today means "one agent can leave a note for another agent that
happens to read the same key later," not multi-agent collaboration. This is
the gap between the product's stated Swarm pillar and what's implemented.

## 2. Scope decision

Build the smallest version of real role-based coordination on top of what
already exists — `TaskPlan` (existing, in `src/task_planner.py` /
`desktop/src/main` plan files) already has a list of subtasks with
dependency ordering from Step 34's long-horizon planning work. The missing
piece is *role assignment* per subtask and a *shared session* multiple agent
instances read/write into, not a new planning engine.

Explicitly out of scope for this spec: emergent/self-organizing agent
behavior (agents deciding their own roles), cross-machine distribution, and
replacing the existing single-agent `autonomousAgent.ts` loop. This extends
it.

## 3. Design

### 3.1 Role assignment on TaskPlan subtasks

Add an optional `role?: string` field to each subtask in the `TaskPlan`
schema (e.g. `"frontend"`, `"backend"`, `"security-review"`). When absent,
behavior is unchanged (single generalist agent, today's behavior). When
present, `startAutonomousSession()` only claims subtasks matching the role
it was started with.

### 3.2 Shared swarm session store

Replace the flat `agentHandoffStore.ts` map with a session-scoped store:

```ts
interface SwarmSession {
  sessionId: string
  planFile: string
  agents: Array<{ role: string; status: 'running' | 'blocked' | 'done'; lastSubtaskId: string | null }>
  handoffs: Map<string, { value: string; writtenByRole: string; ts: number }>
}
```

`setHandoff`/`getHandoff` keep their signatures but now record `writtenByRole`
and live under a `sessionId`, so a security-review agent can specifically
read "what did the backend agent just write" instead of an unscoped global
key.

### 3.3 Gating

A subtask can declare `dependsOnRole: string[]` — e.g. the security-review
role's subtasks list `dependsOnRole: ["backend"]`. `startAutonomousSession()`
checks, before claiming a subtask, whether all declared dependency roles have
at least one `done` agent in the session. This reuses the existing
dependency-ordering logic from Step 34 rather than inventing new scheduling.

### 3.4 Aggregated run report

Extend the existing per-session Markdown report (`generateRunReport()` in
`autonomousAgent.ts`) to, when multiple roles share a `planFile`, render one
combined report with a per-role section instead of one report per agent
instance — so a human reviews one document, not N.

## 4. Why this, not "real" emergent multi-agent behavior

Emergent/CrewAI/AutoGen-style free-form agent negotiation is a much larger,
riskier bet (non-deterministic conversation loops between agents, harder to
audit, harder to bound cost). This system's existing differentiator is
*auditability* (decision log, policy gates, bounded retries) — role-gated
TaskPlan execution keeps that property: every handoff is a recorded,
attributed write, every gate is a checked precondition, nothing is emergent
or opaque. This is the design that fits what's already true about the rest
of the codebase, not the most powerful design in the abstract.

## 5. Out of scope / explicitly not done here

- No new UI for assigning roles — reuse whatever already renders TaskPlan
  subtasks; add a role badge.
- No cross-machine agent distribution.
- No automatic role inference from task description — caller specifies
  roles explicitly when creating the plan.
