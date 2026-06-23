import { useState } from 'react'
import { ZoomIn, ZoomOut, Maximize2, Image } from 'lucide-react'
import { surface, fg, border, accent } from '../../design'

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]

const btnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'inherit',
  padding: '2px 4px',
  display: 'flex',
  alignItems: 'center',
  borderRadius: 3,
  flexShrink: 0,
}

const CHECKER = [
  'linear-gradient(45deg, hsl(0 0% 18%) 25%, transparent 25%)',
  'linear-gradient(-45deg, hsl(0 0% 18%) 25%, transparent 25%)',
  'linear-gradient(45deg, transparent 75%, hsl(0 0% 18%) 75%)',
  'linear-gradient(-45deg, transparent 75%, hsl(0 0% 18%) 75%)',
].join(', ')

export function ImagePreview({ filePath }: { filePath: string }) {
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)

  const name = filePath.split('/').pop() ?? filePath
  const src = `file://${filePath}`

  const zoomIn = () => {
    const cur = zoom === 'fit' ? 1 : (zoom as number)
    const next = ZOOM_STEPS.find((z) => z > cur)
    if (next !== undefined) setZoom(next)
  }
  const zoomOut = () => {
    const cur = zoom === 'fit' ? 1 : (zoom as number)
    const next = [...ZOOM_STEPS].reverse().find((z) => z < cur)
    if (next !== undefined) setZoom(next)
  }

  const zoomLabel = zoom === 'fit' ? 'Fit' : `${Math.round((zoom as number) * 100)}%`
  const pixelated = typeof zoom === 'number' && zoom >= 2

  const imgStyle: React.CSSProperties =
    zoom === 'fit' || !dims
      ? { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }
      : {
          display: 'block',
          width: dims.w * (zoom as number),
          height: dims.h * (zoom as number),
          imageRendering: pixelated ? 'pixelated' : 'auto',
        }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: surface.base }}>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 12px',
          borderBottom: `1px solid ${border[1]}`,
          flexShrink: 0,
          color: fg[2],
        }}
      >
        <Image size={13} color={accent.cyan.fg} />
        <span
          style={{
            fontSize: 12,
            color: fg[1],
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </span>
        {dims && (
          <span style={{ fontSize: 11, color: fg[3], marginRight: 4 }}>
            {dims.w} × {dims.h}
          </span>
        )}
        <button type="button" onClick={zoomOut} title="Zoom out (⌘–)" style={btnStyle}>
          <ZoomOut size={13} />
        </button>
        <span
          style={{
            fontSize: 11,
            color: fg[2],
            minWidth: 38,
            textAlign: 'center',
            userSelect: 'none',
          }}
        >
          {zoomLabel}
        </span>
        <button type="button" onClick={zoomIn} title="Zoom in (⌘+)" style={btnStyle}>
          <ZoomIn size={13} />
        </button>
        <div style={{ width: 1, height: 14, background: border[1], margin: '0 4px', flexShrink: 0 }} />
        <button
          type="button"
          onClick={() => setZoom('fit')}
          title="Fit to window"
          style={{ ...btnStyle, color: zoom === 'fit' ? accent.cyan.fg : fg[2] }}
        >
          <Maximize2 size={13} />
        </button>
        <button
          type="button"
          onClick={() => setZoom(1)}
          title="Actual size (100%)"
          style={{ ...btnStyle, fontSize: 10, color: zoom === 1 ? accent.cyan.fg : fg[2] }}
        >
          1:1
        </button>
      </div>

      {/* Canvas */}
      <div
        style={{
          flex: 1,
          overflow: zoom === 'fit' ? 'hidden' : 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundImage: CHECKER,
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
          backgroundAttachment: 'local',
          padding: zoom === 'fit' ? 24 : 32,
        }}
      >
        <img
          src={src}
          alt={name}
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget
            setDims({ w: img.naturalWidth, h: img.naturalHeight })
          }}
          style={imgStyle}
        />
      </div>
    </div>
  )
}
