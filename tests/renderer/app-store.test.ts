// 補上 renderer 的 window.gc 型別擴充：tsconfig.node.json 未 include src/renderer/**，
// 少了這行 window.gc 會被 @types/node 內建的 `declare var gc` 蓋掉導致 typecheck 失敗。
// 用 triple-slash reference 只在編譯期生效，不會產生實際 import，避免 vitest 執行期找不到模組。
/// <reference path="../../src/renderer/global.d.ts" />
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Board } from '@shared/types'
import { createDefaultBoard, newCard } from '@shared/factory'
import { addCard as reducerAddCard } from '../../src/renderer/store/board-reducer'
import { useAppStore } from '../../src/renderer/store/app-store'

const NOW = '2026-08-27T00:00:00.000Z'

function seqId(prefix: string): () => string {
  let n = 0
  return () => `${prefix}_${n++}`
}

/** col_0[card_a] / col_1[] / col_2[] / col_3[]（四個預設欄位，col_0 內有一張卡片） */
function fixtureBoard(): Board {
  let b = createDefaultBoard(seqId('col'))
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
}

vi.stubGlobal('window', { gc })

beforeEach(() => {
  gc.board.load.mockReset()
  gc.board.save.mockReset()
  gc.pty.kill.mockReset()
  // zustand store 在測試間必須重置，避免前一個測試的 board/activeCardId 汙染下一個測試
  useAppStore.setState({
    board: EMPTY_BOARD,
    activeCardId: null,
    loaded: false,
    recoveryNotice: null,
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
})

describe('dismissRecoveryNotice', () => {
  it('把 notice 設為 null', () => {
    useAppStore.setState({ recoveryNotice: '/tmp/board.corrupt.json' })

    useAppStore.getState().dismissRecoveryNotice()

    expect(useAppStore.getState().recoveryNotice).toBeNull()
  })
})
