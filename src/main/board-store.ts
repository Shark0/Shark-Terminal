import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Board, BoardLoadResult, Card, Column } from '@shared/types'
import { createDefaultBoard } from '@shared/factory'

const SAVE_DEBOUNCE_MS = 500

function isColumn(value: unknown): value is Column {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return (
    typeof c.id === 'string' &&
    typeof c.title === 'string' &&
    typeof c.color === 'string' &&
    Array.isArray(c.cardIds) &&
    c.cardIds.every((id) => typeof id === 'string')
  )
}

function isCard(value: unknown): value is Card {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return (
    typeof c.id === 'string' &&
    typeof c.title === 'string' &&
    typeof c.cwd === 'string' &&
    typeof c.command === 'string' &&
    typeof c.note === 'string' &&
    typeof c.createdAt === 'string' &&
    typeof c.updatedAt === 'string'
  )
}

export function isValidBoard(value: unknown): value is Board {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const b = value as Record<string, unknown>
  if (b.version !== 1) return false
  if (!Array.isArray(b.columns) || !b.columns.every(isColumn)) return false
  if (typeof b.cards !== 'object' || b.cards === null || Array.isArray(b.cards)) return false
  return Object.values(b.cards as Record<string, unknown>).every(isCard)
}

/**
 * 修復引用不一致：
 * 1. 移除 cardIds 中指向不存在卡片的 id
 * 2. 不屬於任何欄位的孤兒卡片放進第一欄；若無任何欄位則捨棄
 * 結構合法但引用錯亂時用這個修，不該讓使用者整個看板被重置。
 */
export function reconcile(board: Board): Board {
  // 也用來偵測同一個 cardId 重複出現在多個欄位——README 明確邀請使用者手動編輯
  // board.json，這種手改造成的重複引用是可達的，重複會讓兩個 useSortable 註冊
  // 同一個 dnd-kit id，拖曳碰撞偵測會有歧義
  const seen = new Set<string>()
  const columns = board.columns.map((c) => ({
    ...c,
    cardIds: c.cardIds.filter((id) => {
      if (!board.cards[id]) {
        console.warn('[board-store] 移除指向不存在卡片的引用', { columnId: c.id, cardId: id })
        return false
      }
      if (seen.has(id)) {
        console.warn('[board-store] 卡片重複出現在多個欄位，只保留第一次', { columnId: c.id, cardId: id })
        return false
      }
      seen.add(id)
      return true
    }),
  }))

  const orphans = Object.keys(board.cards).filter((id) => !seen.has(id))

  if (orphans.length === 0) return { ...board, columns }

  if (columns.length === 0) {
    console.warn('[board-store] 看板沒有任何欄位，捨棄孤兒卡片', { orphans })
    return { ...board, columns, cards: {} }
  }

  console.warn('[board-store] 將孤兒卡片歸入第一欄', { orphans })
  columns[0] = { ...columns[0], cardIds: [...columns[0].cardIds, ...orphans] }
  return { ...board, columns }
}

export class BoardStore {
  private timer: NodeJS.Timeout | null = null
  private pending: Board | null = null
  /** 讀檔失敗且原檔可能存在時進入唯讀，避免後續寫入覆蓋掉讀不到的原檔 */
  private readOnly = false
  /** tmp 檔名遞增序號，同一毫秒內的併發呼叫也不會撞名（Date.now() 沒有這個保證） */
  private tmpSeq = 0
  /** 進行中的寫入，flush() 必須等它完成才能讓 app 安全退出 */
  private writing: Promise<void> | null = null
  /** 最近一次寫入是否失敗（磁碟滿、權限變更等）；供 UI 提示使用 */
  private writeFailed = false
  private errorCb: ((message: string) => void) | null = null

  constructor(
    private readonly filePath: string,
    private readonly debounceMs: number = SAVE_DEBOUNCE_MS,
  ) {}

  /** 最近一次寫入是否處於失敗狀態，供 IPC 查詢 */
  get hasWriteFailure(): boolean {
    return this.writeFailed
  }

  /**
   * 寫入失敗時即時通知外部（main 端會轉發給 renderer）。
   * 補上這個是因為 board:save 的 IPC 回應只能反映「上一輪」debounce 的結果，
   * 若使用者最後一次編輯剛好觸發失敗、之後就直接關閉 app，那次失敗永遠不會
   * 透過下一次 IPC 呼叫被帶回 renderer——推播才能保證即時送達。
   */
  onWriteError(cb: (message: string) => void): void {
    this.errorCb = cb
  }

  async load(): Promise<BoardLoadResult> {
    let raw: string
    try {
      raw = await fs.readFile(this.filePath, 'utf8')
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        // 首次啟動：建立預設看板並立即落地，之後的 save 才有檔案可覆蓋
        const board = createDefaultBoard()
        await this.writeAtomic(board)
        return { board, recoveredFrom: null, readOnly: false }
      }
      // 檔案存在但讀不到（權限、fd 耗盡等）：絕不能覆寫它。
      // 以預設看板讓 app 能啟動，同時進入唯讀模式擋掉後續寫入。
      console.error('[board-store] 讀取 board.json 失敗，改以預設看板啟動並停用寫入', {
        filePath: this.filePath,
        code,
        err,
      })
      this.readOnly = true
      return { board: createDefaultBoard(), recoveredFrom: null, readOnly: true }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      console.warn('[board-store] board.json 解析失敗，備份後回退預設看板', { err })
      return { board: await this.resetToDefault(), recoveredFrom: await this.backup(raw), readOnly: false }
    }

    if (!isValidBoard(parsed)) {
      console.warn('[board-store] board.json 結構不符，備份後回退預設看板')
      return { board: await this.resetToDefault(), recoveredFrom: await this.backup(raw), readOnly: false }
    }

    // 結構合法只是引用錯亂，修好就好，不該讓使用者整個看板消失
    return { board: reconcile(parsed), recoveredFrom: null, readOnly: false }
  }

  /** debounce——拖拉過程中 state 每幀變動，不 debounce 會狂寫磁碟 */
  save(board: Board): void {
    if (this.readOnly) {
      console.warn('[board-store] 目前為唯讀模式，略過此次存檔', { filePath: this.filePath })
      return
    }
    this.pending = board
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.flush().catch((err) => {
        console.error('[board-store] debounce 存檔失敗', { filePath: this.filePath, err })
      })
    }, this.debounceMs)
  }

  /**
   * 立即寫出待寫入內容，app 結束前呼叫以免最後一次變更遺失。
   * 即使目前沒有待寫入內容，也要等前一次尚未完成的寫入——debounce 計時器可能剛好
   * 搶先觸發過一次 flush()，那次的 writeAtomic 還在跑，這裡不等的話 app.exit()
   * 會在寫入中途把程序砍掉，留下半截 .tmp 檔或舊內容。
   */
  async flush(): Promise<void> {
    if (this.readOnly) return
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const board = this.pending
    if (board) {
      this.pending = null
      // 串接而非覆蓋：前一次寫入可能還在進行，覆蓋參照會讓後面的 flush() 等不到它
      const nextWriting: Promise<void> = (this.writing ?? Promise.resolve()).then(async () => {
        await this.writeAtomic(board)
        // 只有當自己仍是目前最新的一條鏈時才清空，避免清掉後面已經排進來的鏈參照
        if (this.writing === nextWriting) this.writing = null
      })
      this.writing = nextWriting
    }
    if (this.writing) await this.writing
  }

  /**
   * 先寫 .tmp 再 rename——rename 是原子操作，避免寫到一半中斷造成半截 JSON。
   * tmp 檔名帶 pid 與遞增序號，避免併發呼叫（例如 renderer 端短時間內觸發兩次 load）搶同一個檔名造成 rename 競態。
   */
  private async writeAtomic(board: Board): Promise<void> {
    const tmp = `${this.filePath}.${process.pid}.${this.tmpSeq++}.tmp`
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      await fs.writeFile(tmp, JSON.stringify(board, null, 2), 'utf8')
      await fs.rename(tmp, this.filePath)
      this.writeFailed = false
    } catch (err) {
      console.error('[board-store] 寫入 board.json 失敗', { filePath: this.filePath, err })
      // 這次寫入沒有真的落地，必須讓 UI 知道，否則使用者會持續編輯一份永遠存不進去的看板
      this.writeFailed = true
      const message = err instanceof Error ? err.message : String(err)
      this.errorCb?.(`看板寫入失敗：${message}`)
      // 清理暫存檔本身也可能失敗（權限等），絕不可讓它把例外往外拋
      try {
        await fs.rm(tmp, { force: true })
      } catch (cleanupErr) {
        console.warn('[board-store] 清理暫存檔失敗，可能殘留 .tmp', { tmp, err: cleanupErr })
      }
    }
  }

  /** 回傳備份檔路徑供 UI 提示；備份失敗回傳 null，但仍照常回退預設看板 */
  private async backup(raw: string): Promise<string | null> {
    const target = `${this.filePath}.corrupt-${Date.now()}`
    try {
      await fs.writeFile(target, raw, 'utf8')
      console.warn('[board-store] 已備份損毀的 board.json', { target })
      return target
    } catch (err) {
      console.error('[board-store] 備份損毀的 board.json 失敗', { target, err })
      return null
    }
  }

  private async resetToDefault(): Promise<Board> {
    const board = createDefaultBoard()
    await this.writeAtomic(board)
    return board
  }
}
