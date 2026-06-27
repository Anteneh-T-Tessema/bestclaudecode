/**
 * E2E coverage for the 4 vision-closeout features (Safe Deploy, Monitor,
 * Ideation, Shared Sessions) added this session. Unlike the unit/integration
 * tests written earlier, these actually drive the real Electron window via
 * CDP — clicking real buttons, reading real rendered DOM, and for Monitor,
 * spawning a real node-pty process. AI-dependent flows (Ideation's Draft
 * Spec, Monitor's Diagnose with AI) are NOT exercised against a live model —
 * there's no `meshflow:e2e:injectMessage`-style hook for them (that hook is
 * wired into ChatPanel's message store, not these panels' direct
 * window.api.ai.streamChat calls) — so this file only verifies what's
 * reachable without spending a real API call: that the panels mount, the
 * sidebar wiring works, and Monitor's non-AI pipeline (spawn → tail →
 * alert-detect → render) works end to end for real.
 */
import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers'

test.describe('Sidebar registration — Monitor and Ideation', () => {
  test('Monitor activity icon is visible and switches to the Monitor panel', async () => {
    const { app, window } = await launchApp()
    try {
      const icon = window.locator('[data-testid="activity-monitor"]')
      await expect(icon).toBeVisible({ timeout: 15_000 })
      await icon.click()
      await expect(window.getByPlaceholder(/vercel logs|docker compose/i)).toBeVisible({ timeout: 5_000 })
      await expect(window.locator('button:has-text("Start")')).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })

  test('Ideation activity icon is visible and switches to the Ideation panel', async () => {
    const { app, window } = await launchApp()
    try {
      const icon = window.locator('[data-testid="activity-ideation"]')
      await expect(icon).toBeVisible({ timeout: 15_000 })
      await icon.click()
      await expect(window.getByPlaceholder(/build a todo app/i)).toBeVisible({ timeout: 5_000 })
      await expect(window.locator('button:has-text("Draft Spec")')).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })

  test('Swarm panel renders its empty state without crashing', async () => {
    const { app, window } = await launchApp()
    try {
      await window.locator('[data-testid="activity-swarm"]').click()
      await expect(window.getByText('No active sessions.')).toBeVisible({ timeout: 5_000 })
    } finally {
      await closeApp(app)
    }
  })

  // Adapted from github.com/Anteneh-T-Tessema/AIDesignPatterns's designer.js —
  // a "describe the agent system you want" -> pattern-aware blueprint panel,
  // next to Ideation rather than a standalone CLI/landing-page, with a
  // "Generate Plan from this blueprint" handoff into Ideation's existing
  // create-plan -> swarm pipeline.
  test('System Architect activity icon is visible and switches to the System Architect panel', async () => {
    const { app, window } = await launchApp()
    try {
      const icon = window.locator('[data-testid="activity-architect"]')
      await expect(icon).toBeVisible({ timeout: 15_000 })
      await icon.click()
      await expect(window.getByPlaceholder(/checks if they are spam/i)).toBeVisible({ timeout: 5_000 })
      await expect(window.locator('button:has-text("Generate System Design")')).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })
})

test.describe('System Architect panel — non-AI behavior', () => {
  test('Generate System Design is disabled until a description is typed', async () => {
    const { app, window } = await launchApp()
    try {
      await window.locator('[data-testid="activity-architect"]').click()
      const generateButton = window.locator('[data-testid="generate-blueprint-button"]')
      await expect(generateButton).toBeDisabled()

      await window.getByPlaceholder(/checks if they are spam/i).fill('A router that triages support tickets')
      await expect(generateButton).toBeEnabled()
    } finally {
      await closeApp(app)
    }
  })

  test('no blueprint output or Send-to-Ideation button before generating', async () => {
    const { app, window } = await launchApp()
    try {
      await window.locator('[data-testid="activity-architect"]').click()
      await expect(window.getByText('Blueprint')).not.toBeVisible()
      await expect(window.locator('button:has-text("Generate Plan from this blueprint")')).not.toBeVisible()
    } finally {
      await closeApp(app)
    }
  })
})

test.describe('Ideation panel — non-AI behavior', () => {
  test('Draft Spec is disabled until an idea is typed', async () => {
    const { app, window } = await launchApp()
    try {
      await window.locator('[data-testid="activity-ideation"]').click()
      const draftButton = window.locator('button:has-text("Draft Spec")')
      await expect(draftButton).toBeDisabled()

      await window.getByPlaceholder(/build a todo app/i).fill('Build a todo app with auth')
      await expect(draftButton).toBeEnabled()
    } finally {
      await closeApp(app)
    }
  })

  // Zero-to-one scaffolding — the "Generate component" box is a separate
  // control from Draft Spec/Generate Plan above, with its own prompt field
  // and disabled-until-typed button.
  test('Generate Component box renders and is disabled until a prompt is typed', async () => {
    const { app, window } = await launchApp()
    try {
      await window.locator('[data-testid="activity-ideation"]').click()
      const generateButton = window.locator('button:has-text("Generate Component")')
      await expect(generateButton).toBeVisible({ timeout: 5_000 })
      await expect(generateButton).toBeDisabled()

      await window.getByPlaceholder(/pricing card with three tiers/i).fill('A footer with social links')
      await expect(generateButton).toBeEnabled()
    } finally {
      await closeApp(app)
    }
  })

  // Clarity fix — Generate Component and Rough idea/Draft Spec render as two
  // near-identical "type something, click button" boxes stacked with no
  // explanation of how they differ; helper copy under each label disambiguates.
  test('Generate Component and Rough idea show distinguishing helper text', async () => {
    const { app, window } = await launchApp()
    try {
      await window.locator('[data-testid="activity-ideation"]').click()
      await expect(window.getByText(/one ready-to-build component/i)).toBeVisible({ timeout: 5_000 })
      await expect(window.getByText(/drafts a full spec/i)).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })
})

test.describe('Monitor panel — real end-to-end pty pipeline (no AI involved)', () => {
  test('a real spawned command streams its output live into the log view', async () => {
    const { app, window } = await launchApp()
    try {
      await window.locator('[data-testid="activity-monitor"]').click()
      const commandInput = window.getByPlaceholder(/vercel logs|docker compose/i)
      await commandInput.fill('echo "hello-e2e-monitor-test"')
      await window.locator('button:has-text("Start")').click()

      // Real node-pty spawn → onData → IPC → renderer render, no mocking.
      await expect(window.getByText('hello-e2e-monitor-test')).toBeVisible({ timeout: 10_000 })
      // The command exits immediately (echo), so the Stop button should
      // revert back to Start without us clicking anything.
      await expect(window.locator('button:has-text("Start")')).toBeVisible({ timeout: 5_000 })
    } finally {
      await closeApp(app)
    }
  })

  test('a line matching the error pattern is flagged into the Alerts feed', async () => {
    const { app, window } = await launchApp()
    try {
      await window.locator('[data-testid="activity-monitor"]').click()
      const commandInput = window.getByPlaceholder(/vercel logs|docker compose/i)
      await commandInput.fill('echo "ERROR: synthetic e2e failure line"')
      await window.locator('button:has-text("Start")').click()

      // The line legitimately renders twice by design — once in the live log,
      // once (timestamp-prefixed) in the Alerts feed — so .first() instead of
      // a strict single-match assertion.
      await expect(window.getByText('ERROR: synthetic e2e failure line').first()).toBeVisible({ timeout: 10_000 })
      // Alerts section header shows a non-zero count once the regex matches —
      // this is the real proof the alert pipeline (not just the log tail) fired.
      await expect(window.getByText(/Alerts \(([1-9]\d*)\)/)).toBeVisible({ timeout: 10_000 })
    } finally {
      await closeApp(app)
    }
  })
})
