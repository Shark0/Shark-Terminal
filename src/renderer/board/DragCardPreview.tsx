import type { Card } from '@shared/types'
import { shortenPath } from './CardItem'

interface Props {
  card: Card
  home: string
}

/** DragOverlay 專用：傾斜 3 度並抬起陰影，與原位置的半透明 placeholder 區隔 */
export default function DragCardPreview({ card, home }: Props): JSX.Element {
  return (
    <div className="w-[244px] rotate-3 rounded-lg border border-line-hover bg-card px-3 py-2 shadow-2xl">
      <div className="truncate text-[13px] leading-5 text-fg">{card.title}</div>
      <div className="mt-0.5 truncate font-mono text-[11px] leading-4 text-fg-dim">
        {shortenPath(card.cwd, home)}
      </div>
    </div>
  )
}
