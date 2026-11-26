import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * threadpool 卡死時抓現場，留給事後追查。
 *
 * 整個流程不能經過 libuv threadpool（卡住的正是它）：檔案一律同步 I/O，
 * 外部指令用 spawn（fork/exec 在主執行緒同步完成），輸出直接導進檔案 fd，不經過 JS。
 */

/** sample 取樣秒數：夠看出每條 thread 停在哪個 syscall，又不至於產出太大的檔 */
const SAMPLE_SECONDS = 3

/** 快照資料夾名稱：ISO 時間把 : 與 . 換成 -，字典序即時間序 */
const SNAPSHOT_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/

interface DiagnosticCommand {
  /** log 與檔名用的短名 */
  name: string
  file: string
  args: (pid: number, dir: string) => string[]
  /** stdout / stderr 導向的檔案 */
  output: string
}

const COMMANDS: DiagnosticCommand[] = [
  // 開著的 fd：libuv 內部通知主迴圈用的 pipe 是否還在、pty 與 pipe 的數量
  { name: 'lsof', file: '/usr/sbin/lsof', args: (pid) => ['-n', '-P', '-p', String(pid)], output: 'lsof.txt' },
  // 整台機器的程序樹與狀態：看卡片裡的程序是否停住（T）或卡在不可中斷的 I/O（U）
  { name: 'ps', file: '/bin/ps', args: () => ['-axo', 'pid,ppid,stat,etime,command'], output: 'ps.txt' },
  // 每條 thread 的 stack：libuv-worker 是閒著還是卡在某個 syscall、主執行緒在做什麼
  {
    name: 'sample',
    file: '/usr/bin/sample',
    args: (pid, dir) => [String(pid), String(SAMPLE_SECONDS), '-file', path.join(dir, 'sample.txt')],
    output: 'sample.log',
  },
]

/** 依資源型別計數，例如 { FSReqPromise: 3, Timeout: 5 }；fs 請求堆積但 worker 閒著，代表完成通知沒送回主迴圈 */
function countActiveResources(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const type of process.getActiveResourcesInfo()) counts[type] = (counts[type] ?? 0) + 1
  return counts
}

/**
 * 在 rootDir 底下建立一份快照，回傳快照資料夾；建立失敗回傳 null。
 * 指令在背景跑完各自寫檔，這裡不等它們。
 */
export function captureStuckDiagnostics(
  rootDir: string,
  context: Record<string, unknown>,
  spawnFn: typeof spawn = spawn,
): string | null {
  const dir = path.join(rootDir, new Date().toISOString().replace(/[:.]/g, '-'))
  try {
    mkdirSync(dir, { recursive: true })
    const info = {
      ...context,
      pid: process.pid,
      capturedAt: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      memory: process.memoryUsage(),
      activeResources: countActiveResources(),
    }
    writeFileSync(path.join(dir, 'info.txt'), `${JSON.stringify(info, null, 2)}\n`)
  } catch (err) {
    console.error('[diagnostics] 建立診斷快照失敗', { dir, err })
    return null
  }

  for (const command of COMMANDS) {
    let fd: number | null = null
    try {
      fd = openSync(path.join(dir, command.output), 'w')
      const child = spawnFn(command.file, command.args(process.pid, dir), { stdio: ['ignore', fd, fd] })
      child.on('error', (err) => {
        console.warn(`[diagnostics] ${command.name} 執行失敗`, { dir, err })
      })
      child.unref()
    } catch (err) {
      console.warn(`[diagnostics] ${command.name} 無法啟動`, { dir, err })
    } finally {
      // 子程序已經 dup 了這個 fd，父程序這份可以關掉
      if (fd !== null) closeSync(fd)
    }
  }

  console.error('[diagnostics] 已建立診斷快照', { dir })
  return dir
}

/**
 * 刪掉舊快照：只留最新 keep 份，且超過 maxAgeMs 的一律刪除。
 * 只動名稱符合快照格式的資料夾，使用者自己放的東西不碰。
 */
export function pruneDiagnostics(rootDir: string, keep: number, maxAgeMs: number, now: number = Date.now()): void {
  let names: string[]
  try {
    names = readdirSync(rootDir).filter((name) => SNAPSHOT_NAME.test(name))
  } catch (err) {
    // 還沒抓過任何快照時資料夾不存在，是常態
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[diagnostics] 讀取診斷資料夾失敗，略過清理', { rootDir, err })
    }
    return
  }

  names.sort().reverse()
  names.forEach((name, index) => {
    const dir = path.join(rootDir, name)
    try {
      if (index < keep && now - statSync(dir).mtimeMs <= maxAgeMs) return
      rmSync(dir, { recursive: true, force: true })
    } catch (err) {
      console.warn('[diagnostics] 刪除舊診斷快照失敗', { dir, err })
    }
  })
}
