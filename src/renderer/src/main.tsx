import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import 'leaflet/dist/leaflet.css'

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 40,
          color: '#ff4d4f',
          background: '#141414',
          height: '100vh',
          fontFamily: 'monospace',
          fontSize: 13
        }}>
          <h2 style={{ color: '#ff4d4f' }}>渲染错误 / Render Error</h2>
          <p style={{ color: '#e0e0e0' }}>{this.state.error.message}</p>
          <pre style={{ color: '#888', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {this.state.error.stack}
          </pre>
          <p style={{ color: '#888', marginTop: 20 }}>按 F12 打开开发者工具查看详细日志</p>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
