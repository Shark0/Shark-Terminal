import { useEffect, useState } from 'react'
import BoardPane from './board/BoardPane'
import RecoveryNotice from './RecoveryNotice'
import { useAppStore } from './store/app-store'

export default function App(): JSX.Element {
  const loaded = useAppStore((s) => s.loaded)
  const loadBoard = useAppStore((s) => s.loadBoard)
  const [home, setHome] = useState('')

  useEffect(() => {
    void loadBoard()
    setHome(window.gc.homeDir())
  }, [loadBoard])

  if (!loaded) {
    return <div className="flex h-full items-center justify-center text-fg-dim">載入中…</div>
  }

  return (
    <div className="flex h-full flex-col bg-base">
      <RecoveryNotice />
      <div className="min-h-0 flex-1">
        <BoardPane home={home} />
      </div>
    </div>
  )
}
