import { useAppStore } from '../store/app-store'
import TerminalHeader from './TerminalHeader'
import TerminalHost from './TerminalHost'

interface Props {
  home: string
}

export default function TerminalPane({ home }: Props): JSX.Element {
  const activeCardId = useAppStore((s) => s.activeCardId)
  const card = useAppStore((s) => (s.activeCardId ? s.board.cards[s.activeCardId] : undefined))
  const status = useAppStore((s) => (s.activeCardId ? s.ptyStatus[s.activeCardId] : undefined))

  return (
    <div className="flex h-full flex-col bg-base">
      {card ? (
        <TerminalHeader card={card} status={status} home={home} />
      ) : (
        <div className="flex h-9 shrink-0 items-center border-b border-line px-3 text-[12px] text-fg-dim">
          {activeCardId ? '卡片已不存在' : '選擇一張卡片以開啟終端機'}
        </div>
      )}
      <div className="min-h-0 flex-1 p-2">
        <TerminalHost />
      </div>
    </div>
  )
}
