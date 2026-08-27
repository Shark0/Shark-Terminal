import { useEffect, useState } from 'react'
import type { Board } from '@shared/types'

/** 等待毫秒數，探針步驟之間需要間隔讓 pty 有時間產生輸出 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * IPC 端到端探針：驗證 preload → contextBridge → ipcMain 整條鏈路是否真的接通。
 * 依序跑過 board / git / pty 全部 channel（dialog:pickDirectory 需要使用者互動，跳過）。
 * 這是 Task 6 專用的暫時性驗證程式碼，Task 7 會整份替換掉。
 */
async function runIpcProbe(): Promise<void> {
  try {
    const { board, recoveredFrom } = await window.gc.board.load()
    console.log('[probe] board:load 成功', { columns: board.columns.length, recoveredFrom })

    await window.gc.board.save(board)
    console.log('[probe] board:save 成功')

    const branch = await window.gc.git.branch(window.gc.homeDir())
    console.log('[probe] git:branch 成功', { branch })

    let ptyOutput = ''
    let sawProbeOk = false
    let exited = false
    window.gc.onPtyData((cardId, data) => {
      ptyOutput += data
      if (!sawProbeOk && ptyOutput.includes('IPC_PROBE_OK')) {
        sawProbeOk = true
        console.log('[probe] pty:data 收到預期輸出 IPC_PROBE_OK', { cardId })
      }
    })
    window.gc.onPtyExit((cardId, exitCode) => {
      exited = true
      console.log('[probe] onPtyExit 被呼叫', { cardId, exitCode })
    })

    await window.gc.pty.spawn('probe', window.gc.homeDir(), 'echo IPC_PROBE_OK', 80, 24)
    console.log('[probe] pty:spawn 成功')

    await delay(2000)
    window.gc.pty.write('probe', 'echo SECOND\n')
    window.gc.pty.resize('probe', 100, 30)
    console.log('[probe] pty:write 與 pty:resize 已送出')

    await delay(2000)
    window.gc.pty.kill('probe')
    console.log('[probe] pty:kill 已送出，等待 onPtyExit')

    // kill 是 send（無回傳值），等一小段時間讓 pty:exit 的事件真的從 main 傳回來
    await delay(1000)
    console.log('[probe] IPC 端到端驗證完成', { sawProbeOk, exitCallbackFired: exited })
  } catch (err) {
    console.error('[probe] IPC 端到端驗證失敗', err)
  }
}

export default function App(): JSX.Element {
  const [board, setBoard] = useState<Board | null>(null)
  const [branch, setBranch] = useState<string | null>(null)

  useEffect(() => {
    void window.gc.board.load().then((result) => setBoard(result.board))
    void window.gc.git.branch(window.gc.homeDir()).then(setBranch)
    void runIpcProbe()
  }, [])

  return (
    <div className="h-full overflow-auto p-6 font-mono text-xs text-fg">
      <p className="mb-2 text-fg-dim">IPC 驗證用畫面（Task 7 將取代）</p>
      <p className="mb-4">home 目錄的 branch：{branch ?? '（非 git repo）'}</p>
      <pre>{board ? JSON.stringify(board, null, 2) : '載入中…'}</pre>
    </div>
  )
}
