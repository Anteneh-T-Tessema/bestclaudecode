/**
 * Swarm coordination — role classification, role-gating, and distinct-role
 * collection. Mirrors the logic in autonomousAgent.ts exactly (same pattern
 * as noActionGuard.test.ts) rather than importing the orchestrator module
 * directly, since that file pulls in electron + a dozen main-process
 * singletons that would all need mocking just to import it.
 */
import { describe, it, expect } from 'vitest'

interface Subtask {
  id: string
  description: string
  depends_on: string[]
  done: boolean
  role?: string
  depends_on_role?: string[]
}

interface TaskPlanDetail {
  goal: string
  slug: string
  subtasks: Subtask[]
}

// Mirrors classifySubtaskRole in autonomousAgent.ts exactly.
function classifySubtaskRole(description: string): string {
  const d = description.toLowerCase()
  if (/test|spec|jest|vitest|pytest|coverage|assert/.test(d)) return 'test'
  if (/security|vuln|injection|xss|auth|rbac|permission|cve/.test(d)) return 'security'
  if (/readme|doc|comment|jsdoc|docstring|changelog/.test(d)) return 'docs'
  if (/component|react|css|tailwind|ui|layout|style|frontend|a11y/.test(d)) return 'frontend'
  if (/api|route|endpoint|database|schema|migration|backend|server/.test(d)) return 'backend'
  return ''
}

// Mirrors effectiveRoleOf in autonomousAgent.ts exactly.
function effectiveRoleOf(subtask: Subtask): string {
  return subtask.role || classifySubtaskRole(subtask.description)
}

// Mirrors roleGateSatisfied in autonomousAgent.ts exactly.
function roleGateSatisfied(plan: TaskPlanDetail, subtask: Subtask): boolean {
  if (!subtask.depends_on_role?.length) return true
  return subtask.depends_on_role.every((role) =>
    plan.subtasks.some((s) => s.done && effectiveRoleOf(s) === role),
  )
}

// Mirrors getPlanRoles's role-collection logic in autonomousAgent.ts exactly.
function distinctRoles(plan: TaskPlanDetail): string[] {
  const seen = new Set<string>()
  for (const s of plan.subtasks) {
    const role = effectiveRoleOf(s)
    if (role) seen.add(role)
  }
  return [...seen]
}

function subtask(overrides: Partial<Subtask>): Subtask {
  return { id: '01', description: '', depends_on: [], done: false, ...overrides }
}

describe('classifySubtaskRole', () => {
  it.each([
    ['Write unit tests for the login flow', 'test'],
    ['Fix the XSS vulnerability in the comment form', 'security'],
    ['Update the README with setup instructions', 'docs'],
    ['Build a React component for the pricing card', 'frontend'],
    ['Add a new API endpoint for user signup', 'backend'],
    ['Think about the overall architecture', ''],
  ])('classifies %j as %j', (description, expected) => {
    expect(classifySubtaskRole(description)).toBe(expected)
  })
})

describe('effectiveRoleOf', () => {
  it('prefers an explicit role over auto-classification', () => {
    expect(effectiveRoleOf(subtask({ role: 'docs', description: 'Add a login endpoint' }))).toBe('docs')
  })

  it('falls back to auto-classification when no explicit role is set', () => {
    expect(effectiveRoleOf(subtask({ description: 'Add a login endpoint' }))).toBe('backend')
  })

  it('returns an empty string when nothing classifies', () => {
    expect(effectiveRoleOf(subtask({ description: 'Think about strategy' }))).toBe('')
  })
})

describe('roleGateSatisfied', () => {
  it('is satisfied when depends_on_role is absent', () => {
    const plan: TaskPlanDetail = { goal: 'g', slug: 's', subtasks: [subtask({ id: '01' })] }
    expect(roleGateSatisfied(plan, subtask({ id: '01' }))).toBe(true)
  })

  it('is unsatisfied when the dependency role has no done subtask yet', () => {
    const backend = subtask({ id: '01', role: 'backend', done: false })
    const securityReview = subtask({ id: '02', role: 'security', depends_on_role: ['backend'] })
    const plan: TaskPlanDetail = { goal: 'g', slug: 's', subtasks: [backend, securityReview] }
    expect(roleGateSatisfied(plan, securityReview)).toBe(false)
  })

  it('is satisfied once at least one subtask of the dependency role is done', () => {
    const backend = subtask({ id: '01', role: 'backend', done: true })
    const securityReview = subtask({ id: '02', role: 'security', depends_on_role: ['backend'] })
    const plan: TaskPlanDetail = { goal: 'g', slug: 's', subtasks: [backend, securityReview] }
    expect(roleGateSatisfied(plan, securityReview)).toBe(true)
  })

  it('requires every declared role, not just one of several', () => {
    const backend = subtask({ id: '01', role: 'backend', done: true })
    const frontend = subtask({ id: '02', role: 'frontend', done: false })
    const securityReview = subtask({ id: '03', role: 'security', depends_on_role: ['backend', 'frontend'] })
    const plan: TaskPlanDetail = { goal: 'g', slug: 's', subtasks: [backend, frontend, securityReview] }
    expect(roleGateSatisfied(plan, securityReview)).toBe(false)
  })

  it('matches the dependency role via auto-classification, not just explicit role', () => {
    const backend = subtask({ id: '01', description: 'Add a new API endpoint', done: true })
    const securityReview = subtask({ id: '02', role: 'security', depends_on_role: ['backend'] })
    const plan: TaskPlanDetail = { goal: 'g', slug: 's', subtasks: [backend, securityReview] }
    expect(roleGateSatisfied(plan, securityReview)).toBe(true)
  })
})

describe('distinctRoles (getPlanRoles role-collection)', () => {
  it('returns an empty array for a plan with no classifiable subtasks', () => {
    const plan: TaskPlanDetail = { goal: 'g', slug: 's', subtasks: [subtask({ description: 'Subtask 1 for: foo' })] }
    expect(distinctRoles(plan)).toEqual([])
  })

  it('returns distinct roles in first-seen order, excluding unclassifiable subtasks', () => {
    const plan: TaskPlanDetail = {
      goal: 'g', slug: 's',
      subtasks: [
        subtask({ id: '01', description: 'Build the login form component' }),
        subtask({ id: '02', description: 'Add the login API endpoint' }),
        subtask({ id: '03', description: 'Write tests for login' }),
        subtask({ id: '04', description: 'Build the signup form component' }),
        subtask({ id: '05', description: 'General planning notes' }),
      ],
    }
    expect(distinctRoles(plan)).toEqual(['frontend', 'backend', 'test'])
  })

  it('respects an explicit role field over auto-classification when collecting roles', () => {
    const plan: TaskPlanDetail = { goal: 'g', slug: 's', subtasks: [subtask({ role: 'docs', description: 'Add a login endpoint' })] }
    expect(distinctRoles(plan)).toEqual(['docs'])
  })
})
