/**
 * E2E tests for RunProposalCard danger classification.
 *
 * These tests inject a fake AI message directly into chat store state via
 * page.evaluate() so they do not require a live AI API key. The card UI is
 * rendered from the injected message exactly as it would be from a real stream.
 */
import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers'

/** Navigate to the Chat panel and wait for it to be fully mounted. */
async function openChat(window: Awaited<ReturnType<typeof launchApp>>['window']) {
  const chatIcon = window.locator('[data-testid="activity-chat"]')
  await chatIcon.waitFor({ state: 'visible', timeout: 5_000 })
  await chatIcon.click()
  // Wait until ChatPanel's textarea is visible — this confirms the component
  // is mounted and its 'meshflow:e2e:injectMessage' listener is attached.
  await window.locator('textarea[placeholder*="Ask anything"]').waitFor({ state: 'visible', timeout: 5_000 })
}

/** Inject a synthetic assistant message containing a <<<RUN>>> block. */
async function injectRunMessage(window: Awaited<ReturnType<typeof launchApp>>['window'], command: string) {
  // Clear any messages persisted to localStorage by previous tests so that
  // not.toBeVisible() checks for 'Blocked'/'Caution' start from a clean slate.
  await window.evaluate(() => {
    window.dispatchEvent(new CustomEvent('meshflow:e2e:clearMessages'))
  })
  await window.waitForTimeout(100)

  await window.evaluate((cmd) => {
    const content = `Here is the command:\n\`\`\`\n<<<RUN>>>\n${cmd}\n<<<END_RUN>>>\n\`\`\``
    window.dispatchEvent(new CustomEvent('meshflow:e2e:injectMessage', {
      detail: { role: 'assistant', content },
    }))
  }, command)
  // Give React a tick to re-render the injected message.
  await window.waitForTimeout(300)
}

test.describe('RunProposalCard — danger classifier', () => {
  test('hard-blocked: rm -rf / shows Blocked banner and no Run button', async () => {
    const { app, window } = await launchApp()
    try {
      await openChat(window)
      await injectRunMessage(window, 'rm -rf /')

      // The hard-block banner must be visible.
      await expect(window.locator('text=Blocked').first()).toBeVisible({ timeout: 8_000 })
      // The "Run" button must NOT appear for a blocked command.
      await expect(window.locator('button:has-text("Run")').first()).not.toBeVisible()
    } finally {
      await closeApp(app)
    }
  })

  test('hard-blocked: rm -rf / && echo hi is also blocked (regression for $ anchor bypass)', async () => {
    const { app, window } = await launchApp()
    try {
      await openChat(window)
      await injectRunMessage(window, 'rm -rf / && echo hi')

      await expect(window.locator('text=Blocked').first()).toBeVisible({ timeout: 8_000 })
      await expect(window.locator('button:has-text("Run")').first()).not.toBeVisible()
    } finally {
      await closeApp(app)
    }
  })

  test('warn tier: sudo shows Caution banner with I-understand button', async () => {
    const { app, window } = await launchApp()
    try {
      await openChat(window)
      await injectRunMessage(window, 'sudo apt install git')

      await expect(window.locator('text=Caution').first()).toBeVisible({ timeout: 8_000 })
      await expect(window.locator('button:has-text("I understand")').first()).toBeVisible()
      // "Run" should not appear yet — only after confirming.
      await expect(window.locator('button:has-text("Run anyway")').first()).not.toBeVisible()
    } finally {
      await closeApp(app)
    }
  })

  test('warn tier: clicking I-understand reveals Run anyway button', async () => {
    const { app, window } = await launchApp()
    try {
      await openChat(window)
      await injectRunMessage(window, 'sudo apt install git')

      await window.locator('button:has-text("I understand")').first().click()
      await expect(window.locator('button:has-text("Run anyway")').first()).toBeVisible({ timeout: 5_000 })
    } finally {
      await closeApp(app)
    }
  })

  test('safe tier: npm install shows Run button without any warning', async () => {
    const { app, window } = await launchApp()
    try {
      await openChat(window)
      await injectRunMessage(window, 'npm install')

      await expect(window.locator('button:has-text("Run")').first()).toBeVisible({ timeout: 8_000 })
      await expect(window.locator('text=Blocked').first()).not.toBeVisible()
      await expect(window.locator('text=Caution').first()).not.toBeVisible()
    } finally {
      await closeApp(app)
    }
  })
})
