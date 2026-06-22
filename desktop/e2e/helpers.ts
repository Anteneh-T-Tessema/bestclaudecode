import { chromium, type Browser, type Page } from '@playwright/test'
import { CDP_PORT } from './global-setup'

export interface AppHandle {
  browser: Browser
}

// All specs share ONE Electron instance and ONE CDP connection (workers: 1 keeps
// them in the same process).
let sharedBrowser: Browser | undefined
let sharedBrowserPromise: Promise<Browser> | undefined

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser) return sharedBrowser
  if (!sharedBrowserPromise) {
    sharedBrowserPromise = chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`).then((b) => {
      sharedBrowser = b
      return b
    })
  }
  return sharedBrowserPromise
}

export async function launchApp(): Promise<{ app: AppHandle; window: Page }> {
  const browser = await getBrowser()

  let page: Page | undefined
  for (let i = 0; i < 30; i++) {
    const pages = browser.contexts().flatMap((c) => c.pages())
    if (pages.length > 0) { page = pages[0]; break }
    await new Promise((r) => setTimeout(r, 200))
  }
  if (!page) throw new Error('No Electron window found via CDP')

  // Tests share one Electron window across the whole run. Reload resets
  // renderer state back to the initial Audit Trail view before each test.
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  return { app: { browser }, window: page }
}

export async function closeApp(_app: AppHandle): Promise<void> {
  // No-op: browser.close() over a CDP connection terminates the shared
  // Electron instance, which all other tests still need. Actual teardown
  // happens once, centrally, in global-teardown.ts after the whole run.
}
