import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Card, PtyStatus } from '@shared/types'
import { shortenPath } from './path-utils'
import StatusDot from './StatusDot'

// shortenPath 搬到獨立的 .ts 檔案（tests/renderer 底下的測試用 tsconfig.node.json 檢查，
// 沒有開 jsx，import 這個 .tsx 檔案的具名匯出會編譯失敗），這裡重新 export 讓既有的
// import { shortenPath } from './board/CardItem' 呼叫點不用跟著改路徑
export { shortenPath }

interface Props {
  card: Card
  active: boolean
  home: string
  status: PtyStatus | undefined
  /** undefined 代表尚未查詢，null 代表非 git 目錄 */
  branch: string | null | undefined
  onSelect: () => void
  onEdit: () => void
}

export default function CardItem({
  card,
  active,
  home,
  status,
  branch,
  onSelect,
  onEdit,
}: Props): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    // 欄位資訊不從這裡讀——BoardPane 是用 columnIdOfCard 從 board 狀態推導，
    // 這裡放 columnId 只會讓人誤以為欄位資訊來自這個 data
    data: { type: 'card' },
    // dnd-kit 預設 200ms，超出全域約束的 ≤150ms
    transition: { duration: 150, easing: 'ease' },
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
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
      } ${isDragging ? 'opacity-30' : ''}`}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-fg">{card.title}</span>
        <StatusDot status={status} />
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] leading-4 text-fg-dim">
        <span className="min-w-0 truncate">{shortenPath(card.cwd, home)}</span>
        {branch && (
          <span className="shrink-0 truncate rounded bg-base px-1 text-[10px]" title={branch}>
            {branch}
          </span>
        )}
      </div>
    </div>
  )
}
