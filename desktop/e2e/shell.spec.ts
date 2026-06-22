import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers'

test.describe('Shell', () => {
  test('app launches with Audit Trail and Settings activity icons', async () => {
    const { app, window } = await launchApp()
    try {
      await expect(window.locator('[data-testid="activity-audit"]')).toBeVisible({ timeout: 15_000 })
      await expect(window.locator('[data-testid="activity-settings"]')).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })

  test('Audit Trail panel is shown by default', async () => {
    const { app, window } = await launchApp()
    try {
      await expect(window.getByText('Audit Trail', { exact: true })).toBeVisible({ timeout: 15_000 })
    } finally {
      await closeApp(app)
    }
  })

  test('clicking Settings switches the visible panel', async () => {
    const { app, window } = await launchApp()
    try {
      await window.locator('[data-testid="activity-settings"]').click()
      await expect(window.getByText('Settings', { exact: true })).toBeVisible({ timeout: 5_000 })
      await expect(window.locator('text=Engine Health')).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })
})
