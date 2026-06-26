/**
 * Regression coverage for a real bug found while adding the Docker sandbox
 * mode: useSandboxExec/dockerSandboxImage (and the 4 hitl* governance
 * toggles) were missing from settings.handlers.ts's MUTABLE_KEYS allowlist,
 * so settings:set threw on save — silently swallowed by
 * useSettingsStore.save()'s try/catch — and the choice never reached disk.
 * The UI showed a "success" toast regardless. This test proves the round
 * trip through the real IPC + electron-store path, not just local React
 * state, by reloading the renderer (which re-fetches via settings:getAll)
 * and checking the value survived.
 */
import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers'

test.describe('Settings persistence — sandbox mode', () => {
  test('selecting Docker sandbox mode survives a renderer reload', async () => {
    const { app, window } = await launchApp()
    try {
      await window.locator('[data-testid="activity-settings"]').click()
      const select = window.locator('[data-testid="sandbox-mode-select"]')
      await expect(select).toBeVisible({ timeout: 5_000 })

      await select.selectOption('docker')
      await expect(window.getByText('Sandbox execution mode updated')).toBeVisible({ timeout: 5_000 })

      // launchApp() reloads the renderer — settings re-load from the same
      // running main process via settings:getAll, exactly like reopening
      // the app would (minus a full process restart).
      const { window: reloaded } = await launchApp()
      await reloaded.locator('[data-testid="activity-settings"]').click()
      await expect(reloaded.locator('[data-testid="sandbox-mode-select"]')).toHaveValue('docker', { timeout: 5_000 })
    } finally {
      // Reset to the default so this test doesn't leak state into others
      // sharing the one Electron instance for the rest of the run.
      const select = window.locator('[data-testid="sandbox-mode-select"]')
      if (await select.isVisible().catch(() => false)) {
        await select.selectOption('never')
      }
      await closeApp(app)
    }
  })
})
