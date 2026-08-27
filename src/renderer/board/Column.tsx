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

  return (
    <div
      data-testid="column"
      data-title={column.title}
      className="group/column flex w-[260px] shrink-0 flex-col rounded-lg bg-column p-2"
    >
      <ColumnHeader column={column} onAddCard={() => onAddCard(column.id)} />
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {column.cardIds.map((cardId) => {
          const card = cards[cardId]
          if (!card) return null
          return (
            <CardItem
              key={cardId}
              card={card}
              home={home}
              active={activeCardId === cardId}
              onSelect={() => setActiveCard(cardId)}
              onEdit={() => onEditCard(cardId)}
            />
          )
        })}
      </div>
    </div>
  )
}
