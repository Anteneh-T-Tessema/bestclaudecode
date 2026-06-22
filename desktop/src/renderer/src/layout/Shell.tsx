import { useRef, useState, useCallback, useEffect } from 'react'
import { ActivityBar } from './ActivityBar'
import { Sidebar } from './Sidebar'
import { CenterPane } from './CenterPane'
import { RightPanel } from './RightPanel'
import { BottomPanel } from './BottomPanel'
import { surface, border } from '../design'
import { useSettingsStore } from '../store/useSettingsStore'
import { useAppStore } from '../store/useAppStore'

const MIN_SIDEBAR = 160
const MIN_RIGHT = 240
const MIN_BOTTOM = 80
const DEFAULT_SIDEBAR = 240
const DEFAULT_RIGHT = 320
const DEFAULT_BOTTOM = 220

export function Shell() {
  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const bottomOpen = useAppStore((s) => s.bottomPanelOpen)
  const setBottomOpen = useAppStore((s) => s.setBottomPanelOpen)

  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR)
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT)
  const [bottomHeight, setBottomHeight] = useState(DEFAULT_BOTTOM)

  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef<'sidebar' | 'right' | 'bottom' | null>(null)
  const startRef = useRef({ x: 0, y: 0, size: 0 })

  // Load persisted widths
  useEffect(() => {
    if (!settingsLoaded) return
    const loadSizes = async () => {
      const sw = await window.api.settings.get('sidebarWidth')
      const rw = await window.api.settings.get('rightPanelWidth')
      const bh = await window.api.settings.get('bottomPanelHeight')
      if (typeof sw === 'number' && sw >= MIN_SIDEBAR) setSidebarWidth(sw)
      if (typeof rw === 'number' && rw >= MIN_RIGHT) setRightWidth(rw)
      if (typeof bh === 'number' && bh >= MIN_BOTTOM) setBottomHeight(bh)
    }
    loadSizes()
  }, [settingsLoaded])

  const onMouseDown = useCallback(
    (which: 'sidebar' | 'right' | 'bottom') =>
      (e: React.MouseEvent) => {
        e.preventDefault()
        draggingRef.current = which
        startRef.current = {
          x: e.clientX,
          y: e.clientY,
          size: which === 'sidebar' ? sidebarWidth : which === 'right' ? rightWidth : bottomHeight,
        }
      },
    [sidebarWidth, rightWidth, bottomHeight]
  )

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const which = draggingRef.current
      if (!which) return
      const { x, y, size } = startRef.current
      if (which === 'sidebar') {
        const next = Math.max(MIN_SIDEBAR, size + (e.clientX - x))
        setSidebarWidth(next)
      } else if (which === 'right') {
        const next = Math.max(MIN_RIGHT, size - (e.clientX - x))
        setRightWidth(next)
      } else {
        const next = Math.max(MIN_BOTTOM, size - (e.clientY - y))
        setBottomHeight(next)
      }
    }
    const onUp = () => {
      const which = draggingRef.current
      if (!which) return
      draggingRef.current = null
      // Persist
      if (which === 'sidebar') {
        window.api.settings.set('sidebarWidth', sidebarWidth)
      } else if (which === 'right') {
        window.api.settings.set('rightPanelWidth', rightWidth)
      } else {
        window.api.settings.set('bottomPanelHeight', bottomHeight)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [sidebarWidth, rightWidth, bottomHeight])

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden',
        background: surface.base,
        minHeight: 0,
      }}
    >
      {/* Activity Bar */}
      <ActivityBar />

      {/* Sidebar */}
      {sidebarOpen && (
        <>
          <div style={{ width: sidebarWidth, flexShrink: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <Sidebar />
          </div>

          {/* Sidebar resize handle */}
          <div
            className="resize-handle resize-handle--vertical"
            onMouseDown={onMouseDown('sidebar')}
            style={{ borderRight: `1px solid ${border[0]}` }}
          />
        </>
      )}

      {/* Center + Bottom column */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Center pane */}
        <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
          <CenterPane />
        </div>

        {/* Bottom panel resize handle */}
        {bottomOpen && (
          <div
            className="resize-handle resize-handle--horizontal"
            onMouseDown={onMouseDown('bottom')}
            style={{ borderTop: `1px solid ${border[0]}` }}
          />
        )}

        {/* Bottom panel */}
        {bottomOpen && (
          <div style={{ height: bottomHeight, flexShrink: 0, overflow: 'hidden' }}>
            <BottomPanel onClose={() => setBottomOpen(false)} />
          </div>
        )}

        {/* Re-open bottom panel button */}
        {!bottomOpen && (
          <button
            onClick={() => setBottomOpen(true)}
            type="button"
            style={{
              height: 22,
              background: surface.raised,
              border: 'none',
              borderTop: `1px solid ${border[0]}`,
              color: 'hsl(220 8% 54%)',
              cursor: 'pointer',
              fontSize: 11,
              letterSpacing: '0.04em',
            }}
          >
            Terminal
          </button>
        )}
      </div>

      {/* Right panel resize handle */}
      <div
        className="resize-handle resize-handle--vertical"
        onMouseDown={onMouseDown('right')}
        style={{ borderLeft: `1px solid ${border[0]}` }}
      />

      {/* Right panel */}
      <div style={{ width: rightWidth, flexShrink: 0, overflow: 'hidden' }}>
        <RightPanel />
      </div>
    </div>
  )
}
