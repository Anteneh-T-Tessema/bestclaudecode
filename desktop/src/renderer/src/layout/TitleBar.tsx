import { border, fg, surface } from '../design'
import logoUrl from '../assets/logo.png'

export function TitleBar() {
  return (
    <div
      className="drag-region"
      style={
        {
          height: 42,
          background: surface.void,
          borderBottom: `1px solid ${border[2]}`,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 12,
          paddingRight: 12,
          WebkitAppRegion: 'drag',
          flexShrink: 0,
          userSelect: 'none',
        } as React.CSSProperties
      }
    >
      {/* macOS traffic-light spacer */}
      <div style={{ width: 78, flexShrink: 0, pointerEvents: 'none' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none' }}>
        <img src={logoUrl} alt="Meshflow" style={{ width: 22, height: 22, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: fg[0] }}>
          MESHFLOW
        </span>
      </div>
    </div>
  )
}
