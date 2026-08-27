import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Board } from '@shared/types'
import { createDefaultBoard, newCard } from '@shared/factory'
import { BoardStore, isValidBoard, reconcile } from '../../src/main/board-store'

let root: string
let file: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), 'sharkcommand-store-'))
  file = path.join(root, 'board.json')
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function seqId(prefix: string): () => string {
  let n = 0
  return () => `${prefix}_${n++}`
}

function sampleBoard(): Board {
  const board = createDefaultBoard(seqId('col'))
  const card = newCard({ title: 'T', cwd: '/tmp', command: 'claude' }, 'card_1', '2026-08-27T00:00:00.000Z')
  board.columns[0].cardIds.push(card.id)
  board.cards[card.id] = card
  return board
}

describe('isValidBoard', () => {
  it('接受合法看板', () => {
    expect(isValidBoard(sampleBoard())).toBe(true)
  })

  it.each([
    ['null', null],
    ['字串', 'board'],
    ['陣列', []],
    ['version 不是 1', { version: 2, columns: [], cards: {} }],
    ['缺少 columns', { version: 1, cards: {} }],
    ['columns 不是陣列', { version: 1, columns: {}, cards: {} }],
    ['cards 不是物件', { version: 1, columns: [], cards: [] }],
    ['欄位缺少 cardIds', { version: 1, columns: [{ id: 'c', title: 't', color: '#fff' }], cards: {} }],
  ])('拒絕 %s', (_label, value) => {
    expect(isValidBoard(value)).toBe(false)
  })
})

describe('reconcile', () => {
  it('移除 cardIds 中不存在的卡片引用', () => {
    const board = sampleBoard()
    board.columns[0].cardIds.push('card_已刪除')
    const fixed = reconcile(board)
    expect(fixed.columns[0].cardIds).toEqual(['card_1'])
  })

  it('把不屬於任何欄位的孤兒卡片放進第一欄', () => {
    const board = sampleBoard()
    board.cards.card_orphan = newCard(
      { title: '孤兒', cwd: '/tmp', command: 'claude' },
      'card_orphan',
      '2026-08-27T00:00:00.000Z',
    )
    const fixed = reconcile(board)
    expect(fixed.columns[0].cardIds).toContain('card_orphan')
  })

  it('看板本來就一致時內容不變', () => {
    const board = sampleBoard()
    expect(reconcile(board)).toEqual(board)
  })

  it('沒有任何欄位時，孤兒卡片直接捨棄而非拋錯', () => {
    const board: Board = { version: 1, columns: [], cards: sampleBoard().cards }
    const fixed = reconcile(board)
    expect(fixed.columns).toEqual([])
    expect(fixed.cards).toEqual({})
  })
})

describe('BoardStore.load', () => {
  it('檔案不存在時回傳預設看板並建立檔案', async () => {
    const store = new BoardStore(file, seqId('col'))
    const { board, recoveredFrom } = await store.load()
    expect(board.columns.map((c) => c.title)).toEqual(['需求評估中', '開發中', 'Review 中', '等待 Merge'])
    expect(recoveredFrom).toBeNull()
    await expect(fs.access(file)).resolves.toBeUndefined()
  })

  it('讀回先前存檔的內容', async () => {
    const original = sampleBoard()
    await fs.writeFile(file, JSON.stringify(original))
    const { board, recoveredFrom } = await new BoardStore(file, seqId('col')).load()
    expect(board).toEqual(original)
    expect(recoveredFrom).toBeNull()
  })

  it('JSON 損毀時備份原檔、回退預設看板，並回報備份路徑', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await fs.writeFile(file, '{ 這不是合法 JSON')

    const { board, recoveredFrom } = await new BoardStore(file, seqId('col')).load()
    expect(board.columns).toHaveLength(4)
    expect(Object.keys(board.cards)).toHaveLength(0)

    const backups = (await fs.readdir(root)).filter((f) => f.startsWith('board.json.corrupt-'))
    expect(backups).toHaveLength(1)
    expect(recoveredFrom).toBe(path.join(root, backups[0]))
    expect(await fs.readFile(path.join(root, backups[0]), 'utf8')).toBe('{ 這不是合法 JSON')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('結構不符時同樣備份並回退', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await fs.writeFile(file, JSON.stringify({ version: 99, foo: 'bar' }))

    const { board, recoveredFrom } = await new BoardStore(file, seqId('col')).load()
    expect(board.columns).toHaveLength(4)
    expect(recoveredFrom).not.toBeNull()

    const backups = (await fs.readdir(root)).filter((f) => f.startsWith('board.json.corrupt-'))
    expect(backups).toHaveLength(1)
    warn.mockRestore()
  })

  it('引用不一致時修復而非重置，且不算損毀', async () => {
    const broken = sampleBoard()
    broken.columns[0].cardIds.push('card_不存在')
    await fs.writeFile(file, JSON.stringify(broken))

    const { board, recoveredFrom } = await new BoardStore(file, seqId('col')).load()
    expect(board.columns[0].cardIds).toEqual(['card_1'])
    expect(board.cards.card_1).toBeDefined()
    expect(recoveredFrom).toBeNull()

    const backups = (await fs.readdir(root)).filter((f) => f.startsWith('board.json.corrupt-'))
    expect(backups).toHaveLength(0)
  })
})

describe('BoardStore.save', () => {
  /** 測試一律注入 10ms debounce，搭配真 timer——fake timer 不會等真實檔案 I/O 完成 */
  const DEBOUNCE = 10
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  it('debounce 期間內不寫檔，逾時後才寫', async () => {
    const store = new BoardStore(file, seqId('col'), DEBOUNCE)
    store.save(sampleBoard())

    await expect(fs.access(file)).rejects.toThrow()

    await wait(DEBOUNCE * 5)
    await expect(fs.access(file)).resolves.toBeUndefined()
  })

  it('連續呼叫只寫最後一次的內容', async () => {
    const store = new BoardStore(file, seqId('col'), DEBOUNCE)

    const first = sampleBoard()
    first.columns[0].title = '第一次'
    store.save(first)

    const second = sampleBoard()
    second.columns[0].title = '第二次'
    store.save(second)

    await wait(DEBOUNCE * 5)
    const written = JSON.parse(await fs.readFile(file, 'utf8')) as Board
    expect(written.columns[0].title).toBe('第二次')
  })

  it('flush 立即寫出待寫入內容，不必等 debounce', async () => {
    const store = new BoardStore(file, seqId('col'), 10_000)
    const board = sampleBoard()
    board.columns[0].title = '立即寫出'
    store.save(board)

    await store.flush()

    const written = JSON.parse(await fs.readFile(file, 'utf8')) as Board
    expect(written.columns[0].title).toBe('立即寫出')
  })

  it('沒有待寫入內容時 flush 不建立檔案', async () => {
    const store = new BoardStore(file, seqId('col'), DEBOUNCE)
    await store.flush()
    await expect(fs.access(file)).rejects.toThrow()
  })

  it('寫檔後不留下 .tmp 暫存檔', async () => {
    const store = new BoardStore(file, seqId('col'), DEBOUNCE)
    store.save(sampleBoard())
    await store.flush()
    expect((await fs.readdir(root)).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})
