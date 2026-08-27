import { useCallback, useEffect, useRef } from 'react'

const STORAGE_KEY = 'sharkcommand.splitRatio'
const MIN_RATIO = 0.2
const MAX_RATIO = 0.8

export function loadSplitRatio(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const value = raw === null ? Number.NaN : Number.parseFloat(raw)
    if (Number.isNaN(value)) return 0.5
    return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value))
  } catch (err) {
    console.warn('[Splitter] 讀取分割比例失敗，使用預設值', { err })
    return 0.5
  }
}

interface Props {
  /** 拖曳中持續回報比例（0–1，看板佔的高度） */
  onChange: (ratio: number) => void
  /** 拖曳結束時呼叫，用來觸發 fit */
  onCommit: () => void
}

export default function Splitter({ onChange, onCommit }: Props): JSX.Element {
  const dragging = useRef(false)
  const lastRatio = useRef<number | null>(null)

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current) return
      const ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, e.clientY / window.innerHeight))
      lastRatio.current = ratio
      onChange(ratio)
    },
    [onChange],
  )

  const onPointerUp = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    document.body.style.cursor = ''
    // 拖曳結束才寫 localStorage——pointermove 每幀觸發，逐次寫入純屬浪費
    if (lastRatio.current !== null) {
      try {
        window.localStorage.setItem(STORAGE_KEY, String(lastRatio.current))
      } catch (err) {
        console.warn('[Splitter] 儲存分割比例失敗', { err })
      }
    }
    onCommit()
  }, [onCommit])

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [onPointerMove, onPointerUp])

  return (
    <div
      onPointerDown={(e) => {
        // 捕捉指標：拖曳中若指標移出視窗，pointerup 仍會送達，
        // 否則 dragging 會卡在 true、游標卡在 row-resize
        e.currentTarget.setPointerCapture(e.pointerId)
        dragging.current = true
        document.body.style.cursor = 'row-resize'
      }}
      className="h-1 shrink-0 cursor-row-resize bg-line transition-colors hover:bg-line-hover"
    />
  )
}
