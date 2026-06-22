import { surface, border } from '../design'
import { ChatPanel } from '../components/chat/ChatPanel'

export function RightPanel() {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: surface.surface,
        borderLeft: `1px solid ${border[1]}`,
        overflow: 'hidden',
      }}
    >
      <ChatPanel />
    </div>
  )
}
