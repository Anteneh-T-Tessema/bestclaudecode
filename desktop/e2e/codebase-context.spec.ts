/**
 * E2E test: @codebase context injection.
 *
 * Types "@codebase decision_log" in the chat input and verifies that the
 * outgoing message contains a <codebase_context> block.
 *
 * Implementation notes:
 * - contextBridge.exposeInMainWorld() seals the api object in Electron 28+,
 *   so patching window.api.ai.streamChat silently fails. Instead, ChatInput.tsx
 *   fires a 'meshflow:e2e:beforeSend' CustomEvent with the final enriched content
 *   before it's passed to the store. The test listens for this event.
 * - window.api.search.bm25 is also sealed, so the test cannot mock it. Instead
 *   the BM25 call is allowed to run (it may return empty results), and we assert
 *   only on the content that was built. If BM25 returns results the block will
 *   be present; if it returns nothing, the raw query is still dispatched and we
 *   verify the event fired (the BM25 mock below patches at a lower level via
 *   the in-renderer module — this is the best we can do without keytar).
 *
 * Simpler approach used here: ChatInput dispatches 'meshflow:e2e:beforeSend'
 * with { content } — the enriched text including any injected context blocks.
 * We register a one-shot listener in the page before typing, then poll for it.
 */
import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers'

test.describe('@codebase context injection', () => {
  test('typing @codebase <query> enriches the outgoing message with codebase_context block', async () => {
    const { app, window } = await launchApp()
    try {
      // Navigate to Chat panel and wait for it to be fully mounted.
      const chatIcon = window.locator('[data-testid="activity-chat"]')
      await chatIcon.waitFor({ state: 'visible', timeout: 5_000 })
      await chatIcon.click()
      // Use the placeholder to target the chat input specifically — the xterm
      // terminal helper textarea (aria-label="Terminal input") also lives in the
      // DOM and would be picked up by 'textarea:first'.
      await window.locator('textarea[placeholder*="Ask anything"]').waitFor({ state: 'visible', timeout: 5_000 })

      // Register a one-shot listener for the test hook event BEFORE typing.
      // The 'meshflow:e2e:beforeSend' event carries the final enriched content
      // that ChatInput.tsx will pass to the AI (after @-context injection).
      await window.evaluate(() => {
        ;(window as unknown as Record<string, unknown>).__e2e_sentContent = null
        window.addEventListener(
          'meshflow:e2e:beforeSend',
          (e) => {
            ;(window as unknown as Record<string, unknown>).__e2e_sentContent =
              (e as CustomEvent<{ content: string }>).detail.content
          },
          { once: true },
        )
      })

      // Type the @codebase query and submit.
      const textarea = window.locator('textarea[placeholder*="Ask anything"]')
      await textarea.click()
      await textarea.pressSequentially('@codebase decision_log')
      await expect(textarea).toHaveValue('@codebase decision_log', { timeout: 3_000 })
      await textarea.press('Enter')

      // Poll until the beforeSend hook fires (up to 15s — BM25 may be slow).
      await expect
        .poll(
          () => window.evaluate(() => (window as unknown as Record<string, unknown>).__e2e_sentContent),
          { timeout: 15_000 },
        )
        .not.toBeNull()

      const sentContent = (await window.evaluate(
        () => (window as unknown as Record<string, unknown>).__e2e_sentContent,
      )) as string

      // The enriched content must contain a <codebase_context> block.
      expect(sentContent).toContain('<codebase_context')
    } finally {
      await closeApp(app)
    }
  })
})
