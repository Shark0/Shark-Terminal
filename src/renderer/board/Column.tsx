import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Column as ColumnType } from '@shared/types'
import { useAppStore } from '../store/app-store'
import CardItem from './CardItem'
import ColumnHeader from './ColumnHeader'

interface Props {
  column: ColumnType
  home: string
  onAddCard: (columnId: string) => void
  onEditCard: (cardId: string) => void
}

export default function Column({ column, home, onAddCard, onEditCard }: Props): JSX.Element {
  const cards = useAppStore((s) => s.board.cards)
  const activeCardId = useAppStore((s) => s.activeCardId)
  const setActiveCard = useAppStore((s) => s.setActiveCard)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.id,
    data: { type: 'column' },
    // dnd-kit 預設 200ms，超出全域約束的 ≤150ms
    transition: { duration: 150, easing: 'ease' },
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-testid="column"
      data-title={column.title}
      className={`group/column flex w-[260px] shrink-0 flex-col rounded-lg bg-column p-2 ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <ColumnHeader
        column={column}
        onAddCard={() => onAddCard(column.id)}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
      <SortableContext items={column.cardIds} strategy={verticalListSortingStrategy}>
        {/* min-h 讓空欄仍有可放置的區域，否則卡片拖不進空欄 */}
        <div className="flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto">
          {column.cardIds.map((cardId) => {
            const card = cards[cardId]
            if (!card) return null
            return (
              <CardItem
                key={cardId}
                card={card}
                columnId={column.id}
                home={home}
                active={activeCardId === cardId}
                onSelect={() => setActiveCard(cardId)}
                onEdit={() => onEditCard(cardId)}
              />
            )
          })}
        </div>
      </SortableContext>
    </div>
  )
}
