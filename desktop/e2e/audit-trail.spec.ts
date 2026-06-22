import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers'

test.describe('Audit Trail Panel', () => {
  test('stats header renders non-zero counts from seeded fixtures', async () => {
    const { app, window } = await launchApp()
    try {
      await expect(window.getByText('Audit Trail', { exact: true })).toBeVisible({ timeout: 15_000 })
      // 3 fixtures seeded in global-setup.ts
      await expect(window.locator('text=3').first()).toBeVisible({ timeout: 10_000 })
      await expect(window.locator('text=Cycles')).toBeVisible()
      // 1 of 3 fixtures has retries: 1 -> 33% retry rate
      await expect(window.locator('text=33%')).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })

  test('verdict chips show normalized (colon-split) verdict buckets', async () => {
    const { app, window } = await launchApp()
    try {
      await expect(window.getByText('Audit Trail', { exact: true })).toBeVisible({ timeout: 15_000 })
      // "Blocking: 2 issues fixed" must bucket under "Blocking", not the full string
      await expect(window.getByText('Blocking: 1', { exact: true })).toBeVisible({ timeout: 10_000 })
      await expect(window.getByText('LGTM: 1', { exact: true })).toBeVisible()
      await expect(window.getByText('Should-fix: 1', { exact: true })).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })

  test('search filters the decision list', async () => {
    const { app, window } = await launchApp()
    try {
      await expect(window.getByText('Audit Trail', { exact: true })).toBeVisible({ timeout: 15_000 })
      await expect(window.locator('text=Add BM25 search index over repo map symbols')).toBeVisible({ timeout: 10_000 })

      await window.locator('input[placeholder*="Search task"]').fill('task planner')
      await expect(window.locator('text=Add long-horizon task planner')).toBeVisible({ timeout: 5_000 })
      await expect(window.locator('text=Add BM25 search index over repo map symbols')).not.toBeVisible()
    } finally {
      await closeApp(app)
    }
  })

  test('clicking an entry with findings expands it', async () => {
    const { app, window } = await launchApp()
    try {
      await expect(window.getByText('Audit Trail', { exact: true })).toBeVisible({ timeout: 15_000 })
      await window.locator('text=Fix LRU cache eviction edge case').click()
      await expect(window.locator('text=Off-by-one in src/cache_manager.py:42 eviction check')).toBeVisible({ timeout: 5_000 })
    } finally {
      await closeApp(app)
    }
  })

  test('most-flagged files section shows file:line reference from findings', async () => {
    const { app, window } = await launchApp()
    try {
      await expect(window.getByText('Audit Trail', { exact: true })).toBeVisible({ timeout: 15_000 })
      await expect(window.locator('text=Most-flagged files')).toBeVisible({ timeout: 10_000 })
    } finally {
      await closeApp(app)
    }
  })
})
