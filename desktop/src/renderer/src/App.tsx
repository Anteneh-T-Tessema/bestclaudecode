import { useEffect } from 'react'
import { Shell } from './layout/Shell'
import { TitleBar } from './layout/TitleBar'
import { StatusBar } from './layout/StatusBar'
import { useAppStore } from './store/useAppStore'
import { CommandPalette } from './components/CommandPalette'
import { QuickOpen } from './components/QuickOpen'
import { SymbolSearch } from './components/SymbolSearch'
import { ToastContainer } from './components/ToastContainer'
import { KeyboardShortcuts } from './components/KeyboardShortcuts'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useSettingsStore } from './store/useSettingsStore'
import { useEditorStore } from './store/useEditorStore'
import { useTsExtraLibs } from './hooks/useTsExtraLibs'
import { DARK_TOKENS, LIGHT_TOKENS } from './design/tokens'

function applyThemeVars(tokens: Record<string, string>) {
  const root = document.documentElement
  for (const [prop, val] of Object.entries(tokens)) {
    root.style.setProperty(prop, val)
  }
}

// Seed dark tokens synchronously so there's no flash before React mounts.
applyThemeVars(DARK_TOKENS)

export default function App() {
  const loadSettings = useSettingsStore((s) => s.load)
  const theme = useSettingsStore((s) => s.theme)
  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const zenMode = useAppStore((s) => s.zenMode)
  const restoreSession = useEditorStore((s) => s.restoreSession)
  const saveSession = useEditorStore((s) => s.saveSession)
  const tabs = useEditorStore((s) => s.tabs)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  useTsExtraLibs()

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // Gap 115 — restore the previous session once settings are loaded
  useEffect(() => {
    if (settingsLoaded) void restoreSession()
  }, [settingsLoaded, restoreSession])

  // Gap 115 — persist session whenever open tabs or active tab changes
  useEffect(() => {
    if (settingsLoaded && tabs.length > 0) void saveSession()
  }, [tabs, activeTabId, settingsLoaded, saveSession])

  useEffect(() => {
    applyThemeVars(theme === 'light' ? LIGHT_TOKENS : DARK_TOKENS)
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return (
    <ErrorBoundary>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <TitleBar />
        <ErrorBoundary>
          <Shell />
        </ErrorBoundary>
        {!zenMode && <StatusBar />}
        <CommandPalette />
        <QuickOpen />
        <SymbolSearch />
        <ToastContainer />
        <KeyboardShortcuts />
      </div>
    </ErrorBoundary>
  )
}
