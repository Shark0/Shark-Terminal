import { useCallback, useEffect, useRef, useState } from 'react'
import BoardPane from './board/BoardPane'
import CommandPalette from './CommandPalette'
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
  const setWriteFailedNotice = useAppStore((s) => s.setWriteFailedNotice)
  const [home, setHome] = useState('')
  const [ratio, setRatio] = useState(loadSplitRatio)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const resizeTimer = useRef<number | null>(null)
  /** 看板區＋分隔線＋終端機區的共同容器，Splitter 靠它的 rect 反推自由空間 */
  const splitContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadBoard()
    setHome(window.gc.homeDir())
  }, [loadBoard])

  // pty 的輸出直接寫進對應的 xterm；結束時把卡片轉為 stopped；
  // 看板寫入失敗即時顯示警告，不必等下一次編輯觸發的 IPC 回應才知道
  useEffect(() => {
    const offData = window.gc.onPtyData((cardId, data) => {
      getTerminal(cardId)?.term.write(data)
      markOutput(cardId, Date.now())
    })
    const offExit = window.gc.onPtyExit((cardId) => {
      setPtyStatus(cardId, 'stopped')
    })
    const offWriteError = window.gc.onBoardWriteError((message) => {
      console.error('[App] 看板寫入失敗', { message })
      setWriteFailedNotice()
    })
    return () => {
      offData()
      offExit()
      offWriteError()
    }
  }, [setPtyStatus, setWriteFailedNotice])

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

  // ⌘K 開關搜尋面板；監聽掛在 window 的冒泡階段，xterm 不會對含 metaKey 的組合鍵呼叫
  // preventDefault，所以終端機有焦點時這裡仍收得到
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
      {/* 可拖曳區域，同時為 hiddenInset 的紅綠燈按鈕留出空間 */}
      <div className="drag-region h-7 shrink-0" />
      <RecoveryNotice />
      {/* Splitter 用這個容器的 getBoundingClientRect() 反推自由空間——
          drag-region、RecoveryNotice 的高度都不需要讓 Splitter 知道，
          之後這兩者的樣式再怎麼變也不用回頭改算式 */}
      <div ref={splitContainerRef} className="flex min-h-0 flex-1 flex-col">
        {/* 用 flexGrow 而非百分比高度，橫幅出現時上下比例不會跑掉 */}
        <div style={{ flexGrow: ratio, flexBasis: 0 }} className="min-h-0">
          <BoardPane home={home} />
        </div>
        <Splitter onChange={handleSplitChange} onCommit={scheduleFit} containerRef={splitContainerRef} />
        <div style={{ flexGrow: 1 - ratio, flexBasis: 0 }} className="min-h-0">
          <TerminalPane />
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} home={home} />
    </div>
  )
}
