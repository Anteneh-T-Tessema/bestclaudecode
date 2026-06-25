import type { API } from '../../../preload'

declare global {
  interface Window {
    api: API
    /** Gap 139 — true in the Electron build, undefined in the web/socket build. */
    isElectron?: boolean
  }
}

export {}
