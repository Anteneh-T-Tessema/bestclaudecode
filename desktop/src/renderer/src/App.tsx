import { useEffect } from 'react'
import { Shell } from './layout/Shell'
import { TitleBar } from './layout/TitleBar'
import { StatusBar } from './layout/StatusBar'
import { CommandPalette } from './components/CommandPalette'
import { QuickOpen } from './components/QuickOpen'
import { ToastContainer } from './components/ToastContainer'
import { KeyboardShortcuts } from './components/KeyboardShortcuts'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useSettingsStore } from './store/useSettingsStore'
import { useTsExtraLibs } from './hooks/useTsExtraLibs'

export default function App() {
  const loadSettings = useSettingsStore((s) => s.load)
  useTsExtraLibs()

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  return (
    <ErrorBoundary>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <TitleBar />
        <ErrorBoundary>
          <Shell />
        </ErrorBoundary>
        <StatusBar />
        <CommandPalette />
        <QuickOpen />
        <ToastContainer />
        <KeyboardShortcuts />
      </div>
    </ErrorBoundary>
  )
}
