# Spec: Generative zero-to-one scaffolding

## 1. Current state (verified against the code)

`desktop/src/main/ipc/design.handlers.ts` (82 lines) does one thing:
`design:extract` reads an *existing* project's `tailwind.config.*`, CSS
custom properties from common global stylesheet filenames, and up to 6
theme/token files matched by filename heuristics (`theme`, `tokens`,
`colors`, etc.), and returns them as a `DesignTokens` object. It generates
nothing — it's a read-only extractor for design tokens that already exist on
disk.

`desktop/src/main/ipc/ideation.handlers.ts` (56 lines) does one thing:
`ideation:saveSpec` / `listSpecs` / `readSpec` persist and retrieve Markdown
spec files under `<projectPath>/.meshflow/specs/<slug>.md`. It is a CRUD
layer over Markdown files — it does not generate UI, components, or
scaffolds from a natural-language prompt.

Neither handler calls a model. There is no code path anywhere in
`desktop/src/main` that takes a prompt like "build a pricing page with three
tiers" and emits component code — the capability v0 and Lovable are named
for in the original five-pillar framing does not exist in this repo yet.

## 2. Scope decision

Building actual generative UI well (v0/Lovable parity) is a large surface:
template/component libraries, live preview, iterative refinement loops,
framework-specific codegen (React/Vue/Svelte), and a design-token-aware
prompt pipeline so generated output matches the existing project's look
rather than producing generic Tailwind defaults.

This spec scopes the **first slice only**: single-component generation that
*uses* the already-built `design:extract` output as context, writes through
the already-built `coding-agent` + worktree-isolation pipeline (not a new
direct-write path), and stops short of full-page/app scaffolding or a
dedicated live-preview renderer. That keeps it consistent with how the rest
of this system ships agent output — reviewed, isolated, auditable — instead
of adding a second, ungoverned code-generation path.

Explicitly out of scope: multi-page app scaffolding, a custom live-preview
iframe/sandbox renderer (Storybook or the existing dev server can serve
this), automatic framework detection beyond what `design:extract` already
infers from `tailwind.config.*` presence.

## 3. Design

### 3.1 New IPC handler: `ideation:generateComponent`

```ts
ipcMain.handle('ideation:generateComponent', async (
  _event,
  projectPath: string,
  prompt: string
): Promise<{ taskDescription: string } | null> => {
  const tokens = await extractDesignTokens(projectPath) // reuse design.handlers.ts logic directly, not via a second IPC round-trip
  const taskDescription = buildComponentTask(prompt, tokens)
  return { taskDescription }
})
```

`buildComponentTask()` formats a task description string embedding the
extracted Tailwind config / CSS vars / theme file excerpts alongside the
user's prompt — e.g. "Generate a React component for: {prompt}. Match this
project's existing design tokens: {tokens}." This is then handed to the
existing `/implement` or `/context-implement` pipeline (`coding-agent` +
`code-reviewer`, worktree isolation, decision log) exactly like any other
task — no new write path, no new review path.

### 3.2 Renderer wiring

A "Generate component" action in the ideation UI calls
`ideation:generateComponent` to build the task description, then hands that
string to the existing implement-task IPC call (whatever the renderer
already uses to kick off `/implement`-equivalent runs) — reuses the existing
agent-invocation plumbing rather than adding a second one.

### 3.3 What stays explicitly unbuilt in this slice

- No live preview renderer — output is a real component file in the repo;
  the user runs the existing dev server to see it, same as any other
  agent-written code.
- No multi-component/page-level scaffolding in one call — one prompt
  produces one component-scoped task. Page assembly is a second,
  user-initiated `/implement` call composing the generated components,
  consistent with how this system already treats multi-step work via
  `/plan-implement`.

## 4. Why this, not a bespoke generation engine

This system's existing differentiator is that every agent write goes through
worktree isolation + review + decision log. A standalone "generate and write
directly" path (the way v0/Lovable work) would be faster to demo but would
create a second, ungoverned code path inconsistent with everything else this
product claims about auditability. Routing generation through the existing
`coding-agent` pipeline is slower per-generation but keeps the one property
this product can actually defend against Cursor/Devin/Windsurf.

## 5. Follow-up (not in this spec)

Full v0/Lovable parity — live preview, multi-page scaffolds, iterative
refine-in-place — is a second spec once this slice is shipped and the
task-description-injection approach is validated against real usage.
