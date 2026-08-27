// 補上 renderer 的 window.gc 型別擴充：tsconfig.node.json 未 include src/renderer/**，
// 少了這行 window.gc 會被 @types/node 內建的 `declare var gc` 蓋掉導致 typecheck 失敗。
// 用 triple-slash reference 只在編譯期生效，不會產生實際 import，避免 vitest 執行期找不到模組。
/// <reference path="../../src/renderer/global.d.ts" />
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COLUMN_COLORS, type Board } from '@shared/types'
import { newCard, newColumn } from '@shared/factory'
import { addCard as reducerAddCard } from '../../src/renderer/store/board-reducer'
import { useAppStore } from '../../src/renderer/store/app-store'

const NOW = '2026-08-27T00:00:00.000Z'

/** createDefaultBoard() 現在回傳空看板，這裡手動組四個固定欄位供測試用，跟產品的預設看板決策無關 */
function fourColumnBoard(): Board {
  const titles = ['需求評估中', '開發中', 'Review 中', '等待 Merge']
  const columns = titles.map((title, i) => newColumn(title, COLUMN_COLORS[i % COLUMN_COLORS.length], `col_${i}`))
  return { version: 1, columns, cards: {} }
}

/** col_0[card_a] / col_1[] / col_2[] / col_3[]（四個固定欄位，col_0 內有一張卡片） */
function fixtureBoard(): Board {
  let b = fourColumnBoard()
  b = reducerAddCard(
    b,
    'col_0',
    newCard({ title: 'card_a', cwd: '/tmp/a', command: 'claude' }, 'card_a', NOW),
  )
  return b
}

const EMPTY_BOARD: Board = { version: 1, columns: [], cards: {} }

/** window.gc 的 mock，測試皆透過此物件斷言呼叫參數 */
const gc = {
  board: { load: vi.fn(), save: vi.fn() },
  pty: { kill: vi.fn() },
  git: { branch: vi.fn() },
}

vi.stubGlobal('window', { gc })

beforeEach(() => {
  gc.board.load.mockReset()
  gc.board.save.mockReset()
  gc.pty.kill.mockReset()
  gc.git.branch.mockReset()
  // zustand store 在測試間必須重置，避免前一個測試的 board/activeCardId 汙染下一個測試
  useAppStore.setState({
    board: EMPTY_BOARD,
    activeCardId: null,
    loaded: false,
    recoveryNotice: null,
    ptyStatus: {},
    branches: {},
  })
})

describe('loadBoard', () => {
  it('成功時把 board 與 recoveryNotice 寫進 state', async () => {
    const board = fixtureBoard()
    gc.board.load.mockResolvedValue({ board, recoveredFrom: '/tmp/board.corrupt.json' })

    await useAppStore.getState().loadBoard()

    const state = useAppStore.getState()
    expect(state.board).toEqual(board)
    expect(state.loaded).toBe(true)
    expect(state.recoveryNotice).toBe('/tmp/board.corrupt.json')
  })

  it('失敗時退回空白看板、loaded 仍為 true、且記錄 console.error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    gc.board.load.mockRejectedValue(new Error('讀取失敗'))

    await useAppStore.getState().loadBoard()

    const state = useAppStore.getState()
    expect(state.board).toEqual(EMPTY_BOARD)
    expect(state.loaded).toBe(true)
    expect(errorSpy).toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  it('併發呼叫時共用同一個 in-flight promise，只觸發一次 window.gc.board.load', async () => {
    let resolveLoad: (value: { board: Board; recoveredFrom: string | null }) => void = () => {}
    const pending = new Promise<{ board: Board; recoveredFrom: string | null }>((resolve) => {
      resolveLoad = resolve
    })
    gc.board.load.mockReturnValue(pending)
    const board = fixtureBoard()

    // 模擬 React StrictMode 讓 effect 跑兩次的情境：第二次呼叫在第一次尚未 resolve 時發生
    const p1 = useAppStore.getState().loadBoard()
    const p2 = useAppStore.getState().loadBoard()

    expect(gc.board.load).toHaveBeenCalledTimes(1)
    expect(p1).toBe(p2)

    resolveLoad({ board, recoveredFrom: null })
    await p1

    const state = useAppStore.getState()
    expect(state.board).toEqual(board)
    expect(state.loaded).toBe(true)
  })
})

describe('loadBranches', () => {
  it('單一 cwd 讀取失敗時，其他 cwd 的 branch 仍然正常寫入', async () => {
    let board = fourColumnBoard()
    board = reducerAddCard(
      board,
      'col_0',
      newCard({ title: 'card_ok', cwd: '/tmp/ok', command: 'claude' }, 'card_ok', NOW),
    )
    board = reducerAddCard(
      board,
      'col_0',
      newCard({ title: 'card_fail', cwd: '/tmp/fail', command: 'claude' }, 'card_fail', NOW),
    )
    useAppStore.setState({ board })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    gc.git.branch.mockImplementation(async (cwd: string) => {
      if (cwd === '/tmp/fail') throw new Error('讀取失敗')
      return 'main'
    })

    await useAppStore.getState().loadBranches()

    expect(useAppStore.getState().branches).toEqual({ '/tmp/ok': 'main' })
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })
})

describe('addCard', () => {
  it('呼叫 window.gc.board.save 一次，且傳入的 board 真的含有新卡片', () => {
    useAppStore.setState({ board: fixtureBoard(), loaded: true })

    useAppStore.getState().addCard('col_1', { title: '新卡片', cwd: '/tmp/new', command: 'claude' })

    expect(gc.board.save).toHaveBeenCalledTimes(1)
    const savedBoard = gc.board.save.mock.calls[0][0] as Board
    const col1 = savedBoard.columns.find((c) => c.id === 'col_1')
    expect(col1?.cardIds).toHaveLength(1)
    const newCardId = col1?.cardIds[0] as string
    expect(savedBoard.cards[newCardId].title).toBe('新卡片')
    expect(savedBoard.cards[newCardId].cwd).toBe('/tmp/new')

    // persist 是「先 set 再 save」，state 應與存檔內容一致
    expect(useAppStore.getState().board).toEqual(savedBoard)
  })
})

describe('deleteCard', () => {
  it('呼叫 window.gc.pty.kill(cardId)，且刪除的是 activeCardId 時把它設為 null', () => {
    useAppStore.setState({ board: fixtureBoard(), activeCardId: 'card_a', loaded: true })

    useAppStore.getState().deleteCard('card_a')

    expect(gc.pty.kill).toHaveBeenCalledWith('card_a')
    expect(useAppStore.getState().activeCardId).toBeNull()
    expect(useAppStore.getState().board.cards.card_a).toBeUndefined()
  })

  it('刪除非 activeCardId 的卡片時不動 activeCardId', () => {
    let board = fixtureBoard()
    board = reducerAddCard(
      board,
      'col_0',
      newCard({ title: 'card_b', cwd: '/tmp/b', command: 'claude' }, 'card_b', NOW),
    )
    useAppStore.setState({ board, activeCardId: 'card_b', loaded: true })

    useAppStore.getState().deleteCard('card_a')

    expect(gc.pty.kill).toHaveBeenCalledWith('card_a')
    expect(useAppStore.getState().activeCardId).toBe('card_b')
  })

  it('pty.kill 拋出時仍完成刪除、清空 activeCardId、呼叫 save，並記錄 console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    gc.pty.kill.mockImplementationOnce(() => {
      throw new Error('kill 失敗')
    })
    useAppStore.setState({ board: fixtureBoard(), activeCardId: 'card_a', loaded: true })

    useAppStore.getState().deleteCard('card_a')

    expect(useAppStore.getState().activeCardId).toBeNull()
    expect(useAppStore.getState().board.cards.card_a).toBeUndefined()
    expect(gc.board.save).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })
})

describe('setPtyStatus', () => {
  it('卡片不存在時是 no-op，ptyStatus 完全不變', () => {
    useAppStore.setState({ board: fixtureBoard(), ptyStatus: { card_a: 'running' }, loaded: true })

    useAppStore.getState().setPtyStatus('card_ghost', 'stopped')

    expect(useAppStore.getState().ptyStatus).toEqual({ card_a: 'running' })
  })

  it('迴歸：deleteCard 之後，延遲送達的 pty:exit 呼叫 setPtyStatus 不會讓該卡片的狀態復活', () => {
    useAppStore.setState({ board: fixtureBoard(), ptyStatus: { card_a: 'running' }, loaded: true })

    useAppStore.getState().deleteCard('card_a')
    // 模擬 main 端稍後才送達的 pty:exit——這時卡片已經不存在於 board.cards，
    // 若 setPtyStatus 無條件 merge，這裡會讓 ptyStatus.card_a 死灰復燃
    useAppStore.getState().setPtyStatus('card_a', 'stopped')

    expect(useAppStore.getState().ptyStatus).toEqual({})
  })
})

describe('deleteColumn', () => {
  it('對欄內每張卡片呼叫 pty.kill，且 activeCardId 在其中時清空', () => {
    let board = fixtureBoard()
    board = reducerAddCard(
      board,
      'col_0',
      newCard({ title: 'card_b', cwd: '/tmp/b', command: 'claude' }, 'card_b', NOW),
    )
    useAppStore.setState({ board, activeCardId: 'card_b', loaded: true })

    useAppStore.getState().deleteColumn('col_0')

    expect(gc.pty.kill).toHaveBeenCalledWith('card_a')
    expect(gc.pty.kill).toHaveBeenCalledWith('card_b')
    expect(gc.pty.kill).toHaveBeenCalledTimes(2)
    expect(useAppStore.getState().activeCardId).toBeNull()
    expect(useAppStore.getState().board.columns.find((c) => c.id === 'col_0')).toBeUndefined()
  })

  it('activeCardId 不在被刪欄位內時維持不變', () => {
    const board = fixtureBoard()
    useAppStore.setState({ board, activeCardId: 'card_a', loaded: true })

    useAppStore.getState().deleteColumn('col_1')

    expect(gc.pty.kill).not.toHaveBeenCalled()
    expect(useAppStore.getState().activeCardId).toBe('card_a')
  })

  it('第一張卡片 kill 拋出時，後續卡片的 kill 仍會被呼叫（逐張包 try/catch，而非包整個迴圈）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let board = fixtureBoard()
    board = reducerAddCard(
      board,
      'col_0',
      newCard({ title: 'card_b', cwd: '/tmp/b', command: 'claude' }, 'card_b', NOW),
    )
    useAppStore.setState({ board, activeCardId: null, loaded: true })
    gc.pty.kill.mockImplementationOnce(() => {
      throw new Error('第一張卡片 kill 失敗')
    })

    useAppStore.getState().deleteColumn('col_0')

    // 若迴圈整個包一次 try/catch，第一次拋出後 card_b 就不會被呼叫到，這裡會只等於 1 次
    expect(gc.pty.kill).toHaveBeenCalledTimes(2)
    expect(gc.pty.kill).toHaveBeenCalledWith('card_a')
    expect(gc.pty.kill).toHaveBeenCalledWith('card_b')
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('清掉被刪欄位內每張卡片的 ptyStatus，欄位外的卡片不受影響（既不漏刪也不刪多）', () => {
    let board = fixtureBoard()
    board = reducerAddCard(
      board,
      'col_0',
      newCard({ title: 'card_b', cwd: '/tmp/b', command: 'claude' }, 'card_b', NOW),
    )
    useAppStore.setState({
      board,
      activeCardId: null,
      loaded: true,
      ptyStatus: { card_a: 'running', card_b: 'idle', card_c: 'running' },
    })

    useAppStore.getState().deleteColumn('col_0')

    expect(useAppStore.getState().ptyStatus).toEqual({ card_c: 'running' })
  })
})

describe('dismissRecoveryNotice', () => {
  it('把 notice 設為 null', () => {
    useAppStore.setState({ recoveryNotice: '/tmp/board.corrupt.json' })

    useAppStore.getState().dismissRecoveryNotice()

    expect(useAppStore.getState().recoveryNotice).toBeNull()
  })
})

describe('previewBoard / commitBoard / restoreBoard', () => {
  it('previewBoard 更新 state 但不存檔', () => {
    const original = fixtureBoard()
    const previewed = reducerAddCard(
      original,
      'col_1',
      newCard({ title: 'preview_card', cwd: '/tmp/preview', command: 'claude' }, 'card_preview', NOW),
    )
    useAppStore.setState({ board: original, loaded: true })

    useAppStore.getState().previewBoard(previewed)

    expect(useAppStore.getState().board).toEqual(previewed)
    // 拖拉期間每幀都會觸發 onDragOver，若這裡誤呼叫 save 就會每幀丟一次 IPC 存檔
    expect(gc.board.save).not.toHaveBeenCalled()
  })

  it('commitBoard 把目前的 board 存檔', () => {
    const original = fixtureBoard()
    const previewed = reducerAddCard(
      original,
      'col_1',
      newCard({ title: 'preview_card', cwd: '/tmp/preview', command: 'claude' }, 'card_preview', NOW),
    )
    useAppStore.setState({ board: original, loaded: true })
    useAppStore.getState().previewBoard(previewed)

    useAppStore.getState().commitBoard()

    expect(gc.board.save).toHaveBeenCalledTimes(1)
    expect(gc.board.save).toHaveBeenCalledWith(previewed)
  })

  it('restoreBoard 還原 state，且不存檔（取消操作不該留下痕跡）', () => {
    const snapshot = fixtureBoard()
    const previewed = reducerAddCard(
      snapshot,
      'col_1',
      newCard({ title: 'preview_card', cwd: '/tmp/preview', command: 'claude' }, 'card_preview', NOW),
    )
    useAppStore.setState({ board: snapshot, loaded: true })
    useAppStore.getState().previewBoard(previewed)

    useAppStore.getState().restoreBoard(snapshot)

    expect(useAppStore.getState().board).toEqual(snapshot)
    expect(gc.board.save).not.toHaveBeenCalled()
  })
})
