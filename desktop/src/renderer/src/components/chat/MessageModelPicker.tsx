import { useState, useRef, useEffect } from 'react'
import { MODELS } from '../../store/useChatStore'
import { surface, border, fg, accent } from '../../design'
import { ChevronDown } from 'lucide-react'

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: accent.amber.fg,
  openai: accent.green.fg,
  google: accent.blue.fg,
  auto: accent.violet.fg,
}

interface Props {
  value: string | null
  onChange: (model: string | null) => void
}

/** Compact per-message model override picker. Null means "use global default". */
export function MessageModelPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selected = value ? MODELS.find((m) => m.id === value) : null

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        title={selected ? `Override model: ${selected.label}` : 'Override model for this message'}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          background: value ? accent.violet.subtle : 'none',
          border: `1px solid ${value ? accent.violet.border : border[0]}`,
          borderRadius: 6,
          padding: '5px 7px',
          cursor: 'pointer',
          color: value ? accent.violet.fg : fg[3],
        }}
      >
        {selected && (
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: PROVIDER_COLORS[selected.provider] ?? fg[3],
              flexShrink: 0,
            }}
          />
        )}
        <ChevronDown size={11} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            right: 0,
            marginBottom: 4,
            background: surface.overlay,
            border: `1px solid ${border[0]}`,
            borderRadius: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            minWidth: 200,
            zIndex: 300,
            overflow: 'hidden',
          }}
        >
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false) }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '8px 12px',
              background: value === null ? surface.raised : 'none',
              border: 'none',
              borderBottom: `1px solid ${border[1]}`,
              cursor: 'pointer',
              fontSize: 11,
              color: value === null ? fg[0] : fg[2],
              textAlign: 'left',
            }}
          >
            Auto / Default
          </button>
          {MODELS.map((model) => (
            <button
              type="button"
              key={model.id}
              onClick={() => { onChange(model.id); setOpen(false) }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '8px 12px',
                background: value === model.id ? surface.raised : 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 11,
                color: value === model.id ? fg[0] : fg[1],
                textAlign: 'left',
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: PROVIDER_COLORS[model.provider] ?? fg[3],
                  flexShrink: 0,
                }}
              />
              {model.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
