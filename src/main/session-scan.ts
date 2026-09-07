import path from 'node:path'

/** 一張卡片對應的 pty shell：pid 是 shell 本身，cwd 是卡片設定的工作目錄 */
export interface PtyEntry {
  cardId: string
  pid: number
  cwd: string
}

/** Claude Code 寫在 sessions/<pid>.json 裡、掃描會用到的欄位 */
export interface ClaudeSession {
  /** busy：正在處理回合；shell / idle / waiting 都代表回合已結束、在等使用者 */
  status: string
  /** 程序啟動時間（ps lstart 格式），用來排除 pid 被回收後殘留的陳舊檔；舊版沒有這欄時為 null */
  procStart: string | null
}

/**
 * 掃描所需的作業系統存取全部注入，測試才能用假資料驗證邏輯。
 * 正式環境的實作在 scan-deps.ts。
 */
export interface ScanDeps {
  /** `ps -axo pid=,ppid=,etime=,lstart=` 的原始輸出（LC_ALL=C、TZ=UTC，才能與 procStart 比對） */
  ps: () => Promise<string>
  /** `lsof -a -d cwd -Fn -p <pids>` 的原始輸出，只需 cwd 那一個 fd */
  lsofCwd: (pids: number[]) => Promise<string>
  /**
   * 讀 Claude Code 的 session 檔。
   * null：沒有這個檔（不是 claude 的程序）；'unreadable'：檔案存在但暫時讀不到或解析失敗
   * （Claude 是原地覆寫，撞上寫入中途會讀到半截 JSON），兩者必須分開，後者要保留上一輪記憶
   */
  readClaudeSession: (pid: number) => Promise<ClaudeSession | null | 'unreadable'>
  /** dir 是 git worktree 的根目錄（.git 是檔案且 gitdir 指向 <repo>/.git/worktrees/<name>） */
  isWorktreeRoot: (dir: string) => Promise<boolean>
  /** 解析 symlink。lsof 回報的是 realpath，卡片 cwd 也得轉成 realpath 才比得上 */
  realpath: (p: string) => Promise<string>
}

export interface ProcessInfo {
  /** 存活秒數，越小代表越新啟動 */
  elapsedSec: number
  /** 啟動時間，已把多重空白正規化成單一空白 */
  started: string
}

export interface ProcessTable {
  children: Map<number, number[]>
  info: Map<number, ProcessInfo>
}

/** 解析 ps 的 etime：`[[dd-]hh:]mm:ss`；解析不了視為最舊，不會被挑成最新的程序 */
export function parseEtime(text: string): number {
  const matched = text.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/)
  if (!matched) return Infinity
  const [, days, hours, minutes, seconds] = matched
  return Number(days ?? 0) * 86400 + Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds)
}

/** ps 的 lstart 與 Claude 的 procStart 在單位數日期時都有雙空白，比對前統一成單一空白 */
export function normalizeStart(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

/** 解析 `ps -axo pid=,ppid=,etime=,lstart=`：每行「pid ppid etime lstart…」 */
export function parsePs(output: string): ProcessTable {
  const children = new Map<number, number[]>()
  const info = new Map<number, ProcessInfo>()
  for (const line of output.split('\n')) {
    const parts = line.trim().split(/\s+/)
    // lstart 至少一個 token，湊不滿 4 欄的是空行或壞行
    if (parts.length < 4) continue
    const pid = Number(parts[0])
    const ppid = Number(parts[1])
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue
    const siblings = children.get(ppid)
    if (siblings) siblings.push(pid)
    else children.set(ppid, [pid])
    info.set(pid, { elapsedSec: parseEtime(parts[2]), started: parts.slice(3).join(' ') })
  }
  return { children, info }
}

/** BFS 列出所有子孫：直接子程序在前，離 shell 越近的越先被檢查 */
export function descendantsOf(table: ProcessTable, pid: number): number[] {
  const result: number[] = []
  const queue = [pid]
  while (queue.length > 0) {
    const current = queue.shift() as number
    for (const child of table.children.get(current) ?? []) {
      result.push(child)
      queue.push(child)
    }
  }
  return result
}

/** 解析 `lsof -Fn`：`p<pid>` 開始一個程序區塊，`n<path>` 是該程序 cwd */
export function parseLsofCwd(output: string): Map<number, string> {
  const cwds = new Map<number, string>()
  let pid: number | null = null
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) {
      const parsed = Number(line.slice(1))
      pid = Number.isInteger(parsed) ? parsed : null
    } else if (line.startsWith('n') && pid !== null) {
      cwds.set(pid, line.slice(1))
    }
  }
  return cwds
}

/**
 * 自 cwd 逐層往上找 worktree 根目錄，只在卡片目錄 root 底下找；
 * cwd 等於 root、不在 root 底下、或 root 為空都回 null。
 */
export async function findWorktreeRoot(
  cwd: string,
  root: string,
  isWorktreeRoot: (dir: string) => Promise<boolean>,
): Promise<string | null> {
  if (!root) return null
  // 必須用分隔符邊界比對，否則 /repo-other 會被誤判成 /repo 底下
  const prefix = root.endsWith('/') ? root : `${root}/`
  let dir = cwd
  while (dir !== root && dir.startsWith(prefix)) {
    if (await isWorktreeRoot(dir)) return dir
    const parent = path.dirname(dir)
    // root 為 / 時 prefix 也是 /，任何絕對路徑都通過 startsWith；
    // 靠 dirname 的不動點終止，否則會在 / 無限打轉
    if (parent === dir) return null
    dir = parent
  }
  return null
}

const BUSY = 'busy'
/** Claude Code 2.1.x 的 status 集合；出現集合外的值代表格式可能變了，要留線索 */
const KNOWN_STATUSES = new Set(['busy', 'shell', 'idle', 'waiting'])

interface CardMemory {
  pid: number
  worktree: string | null
  claudeStatus: string | null
}

/**
 * 定期掃描每張卡片 pty shell 的子孫程序，推導兩件事：
 * 1. session 正在哪個 worktree 工作（子孫程序的 cwd 落在卡片目錄底下的 worktree）
 * 2. Claude 的回合是否剛結束（busy 轉為其他任何狀態；讀 Claude Code 自己寫的 session 檔）
 *
 * 用程序 cwd 而非 git 指令，是因為 Claude 是在 session 內建立 worktree 後 cd 進去跑指令，
 * 卡片的 cwd 從頭到尾都是 repo 根目錄，讀根目錄的 HEAD 永遠只會看到 master。
 */
export class SessionScanner {
  private readonly memory = new Map<string, CardMemory>()
  /** 卡片 cwd → realpath 的快取；解析失敗也快取原值，否則每 3 秒 warn 一次 */
  private readonly realpaths = new Map<string, string>()
  /** 已警告過的未知 status 值與陳舊 session 檔 pid，避免每輪重複刷 log */
  private readonly warnedStatuses = new Set<string>()
  private readonly warnedStalePids = new Set<number>()
  private worktreeCb: ((cardId: string, worktree: string | null) => void) | null = null
  private idleCb: ((cardId: string) => void) | null = null
  private timer: NodeJS.Timeout | null = null
  private scanning: Promise<void> | null = null

  constructor(
    private readonly listPtys: () => PtyEntry[],
    private readonly deps: ScanDeps,
  ) {}

  /**
   * worktree 變動時呼叫：偵測到新的（或不同的）worktree 帶路徑；
   * 記住的 worktree 目錄已不存在時帶 null。跑指令的子程序結束只是暫時看不到，不會清除
   */
  onWorktree(cb: (cardId: string, worktree: string | null) => void): void {
    this.worktreeCb = cb
  }

  /** Claude 從 busy 轉為其他任何狀態（idle / waiting / shell）時呼叫 */
  onClaudeIdle(cb: (cardId: string) => void): void {
    this.idleCb = cb
  }

  /** 目前記得的 worktree，renderer 重新載入後用來補回推播過的值 */
  knownWorktrees(): Array<{ cardId: string; worktree: string }> {
    const result: Array<{ cardId: string; worktree: string }> = []
    for (const [cardId, memory] of this.memory) {
      if (memory.worktree) result.push({ cardId, worktree: memory.worktree })
    }
    return result
  }

  start(intervalMs: number): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.scan()
    }, intervalMs)
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  /** 前一次掃描尚未完成時共用同一個 Promise，避免 ps/lsof 疊在一起跑；本身不會 reject */
  scan(): Promise<void> {
    if (this.scanning) return this.scanning
    this.scanning = this.scanOnce()
      .catch((err) => {
        console.warn('[session-scan] 掃描發生未預期錯誤，略過這一輪', { err })
      })
      .finally(() => {
        this.scanning = null
      })
    return this.scanning
  }

  private async scanOnce(): Promise<void> {
    const entries = this.listPtys()
    this.forgetMissing(entries)
    if (entries.length === 0) return

    let table: ProcessTable
    try {
      table = parsePs(await this.deps.ps())
    } catch (err) {
      console.warn('[session-scan] 讀取程序樹失敗，略過這一輪', { err })
      return
    }

    const descendants = new Map<string, number[]>()
    const allPids: number[] = []
    for (const entry of entries) {
      const pids = descendantsOf(table, entry.pid)
      descendants.set(entry.cardId, pids)
      allPids.push(...pids)
    }

    let cwds = new Map<number, string>()
    if (allPids.length > 0) {
      try {
        cwds = parseLsofCwd(await this.deps.lsofCwd(allPids))
      } catch (err) {
        console.warn('[session-scan] 讀取程序 cwd 失敗，這一輪不更新 worktree', { err })
      }
    }

    for (const entry of entries) {
      const pids = descendants.get(entry.cardId) ?? []
      const memory = this.memoryFor(entry)
      const root = await this.rootOf(entry.cwd)
      await this.updateWorktree(entry, root, pids, cwds, table, memory)
      await this.updateClaudeStatus(entry, pids, table, memory)
    }
  }

  /** 卡片的 pty 消失或換了 pid（重啟）就把記憶清掉，新 session 要重新偵測 */
  private forgetMissing(entries: PtyEntry[]): void {
    const alive = new Map(entries.map((e) => [e.cardId, e.pid]))
    for (const [cardId, memory] of this.memory) {
      if (alive.get(cardId) !== memory.pid) this.memory.delete(cardId)
    }
  }

  private memoryFor(entry: PtyEntry): CardMemory {
    const existing = this.memory.get(entry.cardId)
    if (existing) return existing
    const created: CardMemory = { pid: entry.pid, worktree: null, claudeStatus: null }
    this.memory.set(entry.cardId, created)
    return created
  }

  private async rootOf(cwd: string): Promise<string> {
    const cached = this.realpaths.get(cwd)
    if (cached !== undefined) return cached
    let resolved = cwd
    try {
      resolved = await this.deps.realpath(cwd)
    } catch (err) {
      console.warn('[session-scan] 解析卡片目錄的 realpath 失敗，改用原路徑比對', { cwd, err })
    }
    this.realpaths.set(cwd, resolved)
    return resolved
  }

  private async updateWorktree(
    entry: PtyEntry,
    root: string,
    pids: number[],
    cwds: Map<number, string>,
    table: ProcessTable,
    memory: CardMemory,
  ): Promise<void> {
    // 以最新啟動的程序為準：舊 worktree 裡可能還掛著 dev server 這種長命程序，
    // 若取第一個命中的，session 換到新 worktree 後標籤會被舊程序釘住
    let best: { worktree: string; elapsedSec: number } | null = null
    for (const pid of pids) {
      const cwd = cwds.get(pid)
      if (!cwd) continue
      const worktree = await findWorktreeRoot(cwd, root, this.deps.isWorktreeRoot)
      if (!worktree) continue
      const elapsedSec = table.info.get(pid)?.elapsedSec ?? Infinity
      if (!best || elapsedSec < best.elapsedSec) best = { worktree, elapsedSec }
    }

    if (best) {
      if (best.worktree !== memory.worktree) {
        memory.worktree = best.worktree
        this.emitWorktree(entry.cardId, best.worktree)
      }
      return
    }

    // 這一輪沒看到任何在 worktree 裡的程序：跑指令的子程序是暫時性的，
    // 只要目錄還是 worktree 就保留上次結果；目錄已被移除才清除
    if (memory.worktree && !(await this.deps.isWorktreeRoot(memory.worktree))) {
      memory.worktree = null
      this.emitWorktree(entry.cardId, null)
    }
  }

  private async updateClaudeStatus(
    entry: PtyEntry,
    pids: number[],
    table: ProcessTable,
    memory: CardMemory,
  ): Promise<void> {
    // pids 是 BFS 順序，第一個有 session 檔的就是離 shell 最近的主 session；
    // teammate 也是 claude 程序、也有 session 檔，但它們的狀態不代表這張卡片
    let status: string | null = null
    for (const pid of pids) {
      const session = await this.deps.readClaudeSession(pid)
      if (session === null) continue
      // 主 session 檔正被改寫：保留上一輪記憶，也不能往下改讀 teammate 的狀態
      if (session === 'unreadable') return
      if (session.procStart !== null) {
        const started = table.info.get(pid)?.started
        if (started !== undefined && normalizeStart(session.procStart) !== started) {
          // pid 被回收後殘留的陳舊檔（Claude 非正常結束時不會清掉），內容與這個程序無關
          if (!this.warnedStalePids.has(pid)) {
            this.warnedStalePids.add(pid)
            console.warn('[session-scan] session 檔的啟動時間與程序不符，視為陳舊檔忽略', {
              pid,
              procStart: session.procStart,
              started,
            })
          }
          continue
        }
      }
      status = session.status
      break
    }

    if (status !== null && !KNOWN_STATUSES.has(status) && !this.warnedStatuses.has(status)) {
      this.warnedStatuses.add(status)
      console.warn('[session-scan] 未知的 Claude session status，仍視為回合結束處理', { status })
    }

    const previous = memory.claudeStatus
    memory.claudeStatus = status
    // busy 以外的任何狀態都代表回合結束（含 shell：回合已結束但背景 bash 還在跑），
    // 用排除法而非白名單，Claude 新增狀態值時才不會靜默漏掉提示音
    if (previous === BUSY && status !== null && status !== BUSY) {
      this.emitIdle(entry.cardId)
    }
  }

  /** callback 是外部程式碼（IPC 推播、系統提示音），拋錯不能拖垮同一輪的其他卡片 */
  private emitWorktree(cardId: string, worktree: string | null): void {
    try {
      this.worktreeCb?.(cardId, worktree)
    } catch (err) {
      console.warn('[session-scan] worktree callback 拋出例外', { cardId, worktree, err })
    }
  }

  private emitIdle(cardId: string): void {
    try {
      this.idleCb?.(cardId)
    } catch (err) {
      console.warn('[session-scan] idle callback 拋出例外', { cardId, err })
    }
  }
}
