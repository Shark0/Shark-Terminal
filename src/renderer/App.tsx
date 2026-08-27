import { useCallback, useEffect, useRef, useState } from 'react'
import BoardPane from './board/BoardPane'
import RecoveryNotice from './RecoveryNotice'
import Splitter, { loadSplitRatio } from './Splitter'
import { useAppStore } from './store/app-store'
import { markOutput } from './store/pty-activity'
import TerminalPane from './terminal/TerminalPane'
import { fitAndSync, getTerminal } from './terminal/terminal-registry'

const RESIZE_DEBOUNCE_MS = 100

export default function App(): JSX.Element {
  const loaded = useAppStore((s) => s.loaded)
  const loadBoard = useAppStore((s) => s.loadBoard)
  const setPtyStatus = useAppStore((s) => s.setPtyStatus)
  const [home, setHome] = useState('')
  const [ratio, setRatio] = useState(loadSplitRatio)
  const resizeTimer = useRef<number | null>(null)

  useEffect(() => {
    void loadBoard()
    setHome(window.gc.homeDir())
  }, [loadBoard])

  // pty 的輸出直接寫進對應的 xterm；結束時把卡片轉為 stopped
  useEffect(() => {
    const offData = window.gc.onPtyData((cardId, data) => {
      getTerminal(cardId)?.term.write(data)
      markOutput(cardId, Date.now())
    })
    const offExit = window.gc.onPtyExit((cardId) => {
      setPtyStatus(cardId, 'stopped')
    })
    return () => {
      offData()
      offExit()
    }
  }, [setPtyStatus])

  // 狀態燈：500ms 輪詢一次，store 只在狀態真的變化時才更新
  useEffect(() => {
    const timer = window.setInterval(() => {
      useAppStore.getState().refreshPtyStatuses()
    }, 500)
    return () => window.clearInterval(timer)
  }, [])

  // branch：載入後抓一次，之後每 30 秒刷新，checkout 後卡片會自動跟上
  useEffect(() => {
    if (!loaded) return
    void useAppStore.getState().loadBranches()
    const timer = window.setInterval(() => {
      void useAppStore.getState().loadBranches()
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [loaded])

  /** 視窗或分割比例變動後重新 fit；debounce 100ms 避免對 pty 狂發 resize */
  const scheduleFit = useCallback(() => {
    if (resizeTimer.current !== null) window.clearTimeout(resizeTimer.current)
    resizeTimer.current = window.setTimeout(() => {
      const { activeCardId } = useAppStore.getState()
      if (activeCardId) fitAndSync(activeCardId)
    }, RESIZE_DEBOUNCE_MS)
  }, [])

  useEffect(() => {
    window.addEventListener('resize', scheduleFit)
    return () => window.removeEventListener('resize', scheduleFit)
  }, [scheduleFit])

  // 參照必須穩定：內聯函式每次 render 都是新參照，會讓 Splitter 的
  // useCallback([onChange]) 跟著變、進而讓監聽器的 useEffect 在拖曳中反覆重綁
  const handleSplitChange = useCallback(
    (next: number) => {
      setRatio(next)
      scheduleFit()
    },
    [scheduleFit],
  )

  if (!loaded) {
    return <div className="flex h-full items-center justify-center text-fg-dim">載入中…</div>
  }

  return (
    <div className="flex h-full flex-col bg-base">
      <RecoveryNotice />
      {/* 用 flexGrow 而非百分比高度，橫幅出現時上下比例不會跑掉 */}
      <div style={{ flexGrow: ratio, flexBasis: 0 }} className="min-h-0">
        <BoardPane home={home} />
      </div>
      <Splitter onChange={handleSplitChange} onCommit={scheduleFit} />
      <div style={{ flexGrow: 1 - ratio, flexBasis: 0 }} className="min-h-0">
        <TerminalPane />
      </div>
    </div>
  )
}
