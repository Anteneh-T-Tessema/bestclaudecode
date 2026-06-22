import { useState, useRef, useEffect } from 'react'
import { useEditorActionsStore } from '../../store/useEditorActionsStore'
import { surface, border, fg } from '../../design'

export function GoToLine() {
  const { closeGoToLine } = useEditorActionsStore()
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const go = () => {
    const line = parseInt(value, 10)
    if (!isNaN(line) && line > 0) {
      // Dispatch a custom event that MonacoEditor listens for
      window.dispatchEvent(new CustomEvent('lakoora:goToLine', { detail: { line } }))
    }
    closeGoToLine()
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 48,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 200,
        width: 320,
      }}
    >
      <div
        style={{
          background: surface.overlay,
          border: `1px solid ${border[0]}`,
          borderRadius: 8,
          boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
          padding: '10px 12px',
        }}
      >
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go()
            if (e.key === 'Escape') closeGoToLine()
          }}
          placeholder="Go to line..."
          type="number"
          min={1}
          style={{
            width: '100%',
            background: surface.raised,
            border: `1px solid ${border[0]}`,
            borderRadius: 5,
            padding: '7px 10px',
            fontSize: 13,
            color: fg[0],
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>
    </div>
  )
}
