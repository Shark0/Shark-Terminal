import type { Card } from '@shared/types'

/** 把家目錄縮寫成 ~，路徑過長時只留最後兩層 */
export function shortenPath(cwd: string, home: string): string {
  const path = cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd
  const parts = path.split('/')
  return parts.length <= 3 ? path : `…/${parts.slice(-2).join('/')}`
}

interface Props {
  card: Card
  active: boolean
  home: string
  onSelect: () => void
  onEdit: () => void
}

export default function CardItem({ card, active, home, onSelect, onEdit }: Props): JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onEdit()
      }}
      className={`group cursor-pointer rounded-lg border bg-card px-3 py-2 transition-all hover:-translate-y-0.5 hover:border-line-hover ${
        active ? 'border-line-hover ring-1 ring-line-hover' : 'border-line'
      }`}
    >
      <div className="truncate text-[13px] leading-5 text-fg">{card.title}</div>
      <div className="mt-0.5 truncate font-mono text-[11px] leading-4 text-fg-dim">
        {shortenPath(card.cwd, home)}
      </div>
    </div>
  )
}
