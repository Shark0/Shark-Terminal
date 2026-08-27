import { useEffect, useState } from 'react'
import type { Board } from '@shared/types'

export default function App(): JSX.Element {
  const [board, setBoard] = useState<Board | null>(null)
  const [branch, setBranch] = useState<string | null>(null)

  useEffect(() => {
    void window.gc.board.load().then((result) => setBoard(result.board))
    void window.gc.git.branch(window.gc.homeDir()).then(setBranch)
  }, [])

  return (
    <div className="h-full overflow-auto p-6 font-mono text-xs text-fg">
      <p className="mb-2 text-fg-dim">IPC 驗證用畫面（Task 7 將取代）</p>
      <p className="mb-4">home 目錄的 branch：{branch ?? '（非 git repo）'}</p>
      <pre>{board ? JSON.stringify(board, null, 2) : '載入中…'}</pre>
    </div>
  )
}
