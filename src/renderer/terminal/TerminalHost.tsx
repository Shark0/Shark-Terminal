import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/app-store'
import { ensureTerminal, fitAndSync } from './terminal-registry'

interface SlotProps {
  cardId: string
  active: boolean
}

function TerminalSlot({ cardId, active }: SlotProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const opened = useRef(false)

  useEffect(() => {
    if (!ref.current || opened.current) return
    const { term } = ensureTerminal(cardId)
    term.open(ref.current)
    opened.current = true
    fitAndSync(cardId)
  }, [cardId])

  useEffect(() => {
    if (!active) return
    // 切回這張卡片時尺寸可能已經變過，重新 fit 並把新尺寸同步給 pty
    fitAndSync(cardId)
    ensureTerminal(cardId).term.focus()
  }, [active, cardId])

  return (
    <div
      ref={ref}
      // 隱藏用 opacity 而非 display:none——後者會讓容器尺寸歸零，fit 會算錯
      className={
        active
          ? 'absolute inset-0'
          : 'pointer-events-none absolute inset-0 -z-10 opacity-0'
      }
    />
  )
}

export default function TerminalHost(): JSX.Element {
  const activeCardId = useAppStore((s) => s.activeCardId)
  const ptyStatus = useAppStore((s) => s.ptyStatus)

  // 只要啟動過就保留容器，切換卡片不會 unmount 任何 xterm 實例
  const startedIds = Object.keys(ptyStatus)

  return (
    <div className="relative h-full w-full overflow-hidden bg-base">
      {startedIds.map((cardId) => (
        <TerminalSlot key={cardId} cardId={cardId} active={cardId === activeCardId} />
      ))}
    </div>
  )
}
