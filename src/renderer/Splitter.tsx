import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { MAX_RATIO, MIN_RATIO, computeRatio } from './splitter-math'

const STORAGE_KEY = 'sharkterminal.splitRatio'

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
  /**
   * 指向「看板區＋這條分隔線＋終端機區」三者共同的父容器，供 computeRatio 使用。
   * 容器與分隔線的高度都用 getBoundingClientRect() 現場量測，不寫死任何 px，
   * 拖曳條、橫幅等固定元素的樣式之後再怎麼變都不需要回頭改算式。
   */
  containerRef: RefObject<HTMLDivElement>
}

export default function Splitter({ onChange, onCommit, containerRef }: Props): JSX.Element {
  const dragging = useRef(false)
  const lastRatio = useRef<number | null>(null)
  const selfRef = useRef<HTMLDivElement>(null)

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current) return
      const containerRect = containerRef.current?.getBoundingClientRect()
      const splitterHeight = selfRef.current?.getBoundingClientRect().height
      if (!containerRect || splitterHeight === undefined) return
      if (containerRect.height <= splitterHeight) return

      const ratio = computeRatio(e.clientY, containerRect.top, containerRect.height, splitterHeight)
      lastRatio.current = ratio
      onChange(ratio)
    },
    [containerRef, onChange],
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
      ref={selfRef}
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
