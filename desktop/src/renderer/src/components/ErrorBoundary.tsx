import { Component, type ReactNode, type ErrorInfo } from 'react'
import { fg, accent } from '../design'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info)
  }

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div style={{ padding: 16 }}>
          <p style={{ color: accent.red.fg, fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
            Something went wrong
          </p>
          <pre style={{ color: fg[2], fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {this.state.error?.message}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}
