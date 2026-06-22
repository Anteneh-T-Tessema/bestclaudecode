import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react'
import { useToastStore, type ToastKind } from '../store/useToastStore'
import { accent } from '../design'

const ICONS: Record<ToastKind, React.ReactNode> = {
  success: <CheckCircle size={13} color={accent.green.bright} />,
  error: <XCircle size={13} color={accent.red.bright} />,
  info: <Info size={13} color={accent.cyan.bright} />,
  warning: <AlertTriangle size={13} color={accent.amber.bright} />,
}

const COLORS: Record<ToastKind, { bg: string; border: string; text: string }> = {
  success: { bg: accent.green.subtle, border: accent.green.border, text: accent.green.bright },
  error: { bg: accent.red.subtle, border: accent.red.border, text: accent.red.bright },
  info: { bg: accent.cyan.subtle, border: accent.cyan.border, text: accent.cyan.bright },
  warning: { bg: accent.amber.subtle, border: accent.amber.border, text: accent.amber.bright },
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 32,
        right: 20,
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => {
        const c = COLORS[t.kind]
        return (
          <div
            key={t.id}
            style={{
              pointerEvents: 'all',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              background: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: 5,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              minWidth: 220,
              maxWidth: 340,
            }}
          >
            {ICONS[t.kind]}
            <span style={{ flex: 1, fontSize: 12, color: c.text, lineHeight: 1.4 }}>{t.message}</span>
            <button
              type="button"
              onClick={() => removeToast(t.id)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: c.text,
                opacity: 0.5,
                padding: 0,
                flexShrink: 0,
              }}
            >
              <X size={11} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
