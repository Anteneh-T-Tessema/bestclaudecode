import { useChatStore, MODELS } from '../../store/useChatStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { surface, border, fg, accent } from '../../design'
import { ChevronDown } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: accent.amber.fg,
  openai: accent.green.fg,
  google: accent.blue.fg,
}

export function ModelSelector() {
  const activeModel = useChatStore((s) => s.activeModel)
  const setActiveModel = useChatStore((s) => s.setActiveModel)
  const saveSettings = useSettingsStore((s) => s.save)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const currentModel = MODELS.find((m) => m.id === activeModel)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: surface.raised,
          border: `1px solid ${border[0]}`,
          borderRadius: 6,
          padding: '5px 10px',
          cursor: 'pointer',
          fontSize: 12,
          color: fg[1],
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: currentModel ? (PROVIDER_COLORS[currentModel.provider] ?? fg[3]) : fg[3],
            flexShrink: 0,
          }}
        />
        <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {currentModel?.label ?? activeModel}
        </span>
        <ChevronDown size={12} style={{ flexShrink: 0 }} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            marginBottom: 4,
            background: surface.overlay,
            border: `1px solid ${border[0]}`,
            borderRadius: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            minWidth: 220,
            zIndex: 300,
            overflow: 'hidden',
          }}
        >
          {MODELS.map((model) => (
            <button
              key={model.id}
              onClick={() => {
                setActiveModel(model.id)
                void saveSettings({ activeModel: model.id })
                setOpen(false)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '8px 12px',
                background: model.id === activeModel ? surface.raised : 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                color: model.id === activeModel ? fg[0] : fg[1],
                textAlign: 'left',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
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
