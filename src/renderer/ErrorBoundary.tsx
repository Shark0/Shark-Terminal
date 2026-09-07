import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * 沒有 error boundary 時，任何一個元件 render 拋錯都會讓 React 把整棵樹卸載，
 * 視窗只剩 body 的深色背景，使用者看到的就是「畫面黑掉」且無從得知發生什麼事。
 * 這裡接住錯誤、顯示訊息並提供重新載入；終端機 pty 都在 main 端，重新載入不會中斷 session。
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] 畫面元件發生未攔截的錯誤', { error, componentStack: info.componentStack })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-base px-8 text-fg">
        <div className="text-[15px]">畫面發生錯誤</div>
        <pre className="max-h-[40vh] max-w-full overflow-auto rounded border border-line bg-column p-3 font-mono text-[11px] text-fg-dim">
          {error.stack ?? error.message}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded border border-line px-3 py-1.5 text-[12px] text-fg transition-colors hover:border-line-hover"
        >
          重新載入畫面
        </button>
        <div className="text-[11px] text-fg-dim">終端機 session 不受影響，重新載入後會接回</div>
      </div>
    )
  }
}
