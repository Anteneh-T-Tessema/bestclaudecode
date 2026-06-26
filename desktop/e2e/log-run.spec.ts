/**
 * E2E test: logRun audit integration.
 *
 * Executes a safe <<<RUN>>> block (echo hello) via the RunProposalCard "Run"
 * button and then verifies that a new entry with agent "meshflow-run" appears
 * in the Audit Trail panel within 5 seconds. This exercises the full path:
 * RunProposalCard → terminal:logRun IPC → decision_log.py → Audit Trail panel reload.
 */
import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers'

test.describe('logRun audit integration', () => {
  test('executing a safe RUN block creates an audit entry', async () => {
    const { app, window } = await launchApp()
    try {
      // First go to the Audit Trail panel and note the current entry count.
      const auditIcon = window.locator('[data-testid="activity-audit"]')
      await auditIcon.click()
      // Use the all-caps panel header to avoid strict-mode ambiguity with the
      // activity bar label ('Audit Trail' title-case vs 'AUDIT TRAIL' header).
      await expect(window.locator('text=AUDIT TRAIL').first()).toBeVisible({ timeout: 8_000 })

      // Count existing entries (may be 0 on a fresh run).
      const initialCount = await window.locator('[data-testid="audit-entry"]').count()

      // Switch to Chat and inject a safe RUN block.
      const chatIcon = window.locator('[data-testid="activity-chat"]')
      await chatIcon.waitFor({ state: 'visible', timeout: 5_000 })
      await chatIcon.click()
      // Wait until ChatPanel is mounted so its event listener is active.
      await window.locator('textarea[placeholder*="Ask anything"]').waitFor({ state: 'visible', timeout: 5_000 })

      // Clear persisted messages so the only Run button visible is for echo hello.
      await window.evaluate(() => {
        window.dispatchEvent(new CustomEvent('meshflow:e2e:clearMessages'))
      })
      await window.waitForTimeout(100)

      await window.evaluate(() => {
        const content = '<<<RUN>>>\necho hello\n<<<END_RUN>>>'
        window.dispatchEvent(new CustomEvent('meshflow:e2e:injectMessage', {
          detail: { role: 'assistant', content },
        }))
      })
      await window.waitForTimeout(300)

      // Click the Run button on the card.
      await window.locator('button:has-text("Run")').first().click()

      // Wait for the run to complete (output section appears).
      await expect(window.locator('pre').first()).toBeVisible({ timeout: 10_000 })

      // The logRun IPC call is fire-and-forget: it runs a Python subprocess that
      // writes to the decision log file. Give it time to finish before we switch
      // panels and re-read the list.
      await window.waitForTimeout(2_000)

      // Switch back to Audit Trail panel.
      await auditIcon.click()
      // Click Refresh to force a re-load in case the panel mounted before the
      // Python write completed.
      await window.locator('[title="Refresh"]').first().click({ timeout: 5_000 })
      await expect(window.locator('[data-testid="audit-entry"]')).toHaveCount(initialCount + 1, { timeout: 8_000 })

      // The new entry should show the meshflow-run agent label. Scoped to
      // audit-entry rows, not a plain text= locator — the agent filter
      // <select> also has a hidden <option value="meshflow-run"> that a bare
      // text locator matches first (and "hidden" fails toBeVisible()).
      await expect(window.locator('[data-testid="audit-entry"]', { hasText: 'meshflow-run' }).first()).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })
})
