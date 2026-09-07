import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { resolveGitDir } from './git'
import type { ClaudeSession, ScanDeps } from './session-scan'

/** ps / lsof 正常一輪只要幾十毫秒；lsof 遇到失聯的網路掛載點會卡在 stat，必須有上限 */
const COMMAND_TIMEOUT_MS = 2000
/** login shell 要跑完整套 rc，給寬一點 */
const SHELL_PROBE_TIMEOUT_MS = 5000

interface RunOptions {
  /** 雖然非零但不算錯的結束碼——lsof 找不到任何符合項目時以 1 結束，ps 與 lsof 之間程序剛好結束是常態 */
  tolerateExitCode?: number
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

/**
 * 執行外部指令並回傳 stdout。
 * 用絕對路徑：從 Finder / Dock 啟動的 app 只有最精簡的 PATH。
 * 逾時會以 SIGKILL 收掉子程序並 reject（err.code 為 null，不會被 tolerateExitCode 放過）。
 */
function run(file: string, args: string[], options: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        env: options.env ?? process.env,
      },
      (err, stdout) => {
        if (err && err.code !== options.tolerateExitCode) reject(err)
        else resolve(stdout)
      },
    )
  })
}

/**
 * SessionScanner 在 macOS 上的真實實作。
 * getClaudeConfigDir 回傳 Claude Code 的設定目錄（預設 ~/.claude，可用 CLAUDE_CONFIG_DIR 改），
 * 它把每個 session 的狀態寫在 <configDir>/sessions/<pid>.json；用 getter 是因為設定目錄
 * 要靠 login shell 探測、啟動後才確定，掃描器不必等它。
 */
export function createNodeScanDeps(getClaudeConfigDir: () => string): ScanDeps {
  return {
    // C 語系 + UTC：lstart 才會與 Claude 寫的 procStart（"Wed Sep  2 01:42:20 2026"）同格式
    ps: () =>
      run('/bin/ps', ['-axo', 'pid=,ppid=,etime=,lstart='], {
        env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
      }),

    // -b：不做會阻塞的 stat/readlink；-w：壓掉因此產生的警告，否則每輪 stderr 幾 KB
    lsofCwd: (pids) =>
      run(
        '/usr/sbin/lsof',
        ['-a', '-b', '-w', '-n', '-P', '-d', 'cwd', '-Fn', '-p', pids.join(',')],
        { tolerateExitCode: 1 },
      ),

    readClaudeSession: async (pid): Promise<ClaudeSession | null | 'unreadable'> => {
      const file = path.join(getClaudeConfigDir(), 'sessions', `${pid}.json`)
      let raw: string
      try {
        raw = await fs.readFile(file, 'utf8')
      } catch (err) {
        // 不是 claude 的程序沒有這個檔，是常態；其他錯誤要當成「暫時讀不到」保留上一輪記憶
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
        console.warn('[scan-deps] 讀取 Claude session 檔失敗，這一輪保留上次狀態', { file, err })
        return 'unreadable'
      }
      let parsed: { status?: unknown; procStart?: unknown }
      try {
        parsed = JSON.parse(raw) as { status?: unknown; procStart?: unknown }
      } catch (err) {
        // Claude 是原地覆寫，撞上寫入中途會讀到半截 JSON，下一輪再讀即可
        console.warn('[scan-deps] Claude session 檔不是合法 JSON，這一輪保留上次狀態', { file, err })
        return 'unreadable'
      }
      if (typeof parsed.status !== 'string') return null
      return {
        status: parsed.status,
        procStart: typeof parsed.procStart === 'string' ? parsed.procStart : null,
      }
    },

    isWorktreeRoot: async (dir) => {
      const gitEntry = path.join(dir, '.git')
      try {
        if (!(await fs.stat(gitEntry)).isFile()) return false
      } catch (err) {
        // 沒有 .git 是往上找的正常路徑；ENOTDIR 是路徑中段被檔案佔住，同樣正常
        const code = (err as NodeJS.ErrnoException).code
        if (code !== 'ENOENT' && code !== 'ENOTDIR') {
          console.warn('[scan-deps] 檢查 .git 時發生非預期錯誤，視為非 worktree', { dir, code, err })
        }
        return false
      }
      // .git 是檔案不代表就是 worktree：submodule 與 --separate-git-dir 的 repo 也是檔案，
      // 只有 gitdir 指向 <repo>/.git/worktrees/<name> 的才是
      const gitDir = await resolveGitDir(gitEntry)
      if (!gitDir) return false
      return path.basename(path.dirname(gitDir)) === 'worktrees'
    },

    realpath: (p) => fs.realpath(p),
  }
}

const ANSI_ESCAPE = /\x1b\[[0-9;]*[A-Za-z]/g

/**
 * 用 login shell 探測 CLAUDE_CONFIG_DIR。
 * 從 Finder / Dock 啟動的 app 只有 launchd 的最小環境，看不到使用者在 rc 檔 export 的變數，
 * 但卡片內的 zsh -l 會讀 rc，claude 就跟著那個值寫 session 檔；兩邊不一致提示音會永遠不響。
 * -lic：login + interactive 才會跟卡片的 shell 讀同一套 rc（zsh 的 .zshrc 只在 interactive 讀）。
 */
export async function probeClaudeConfigDir(
  shell: string,
  env: NodeJS.ProcessEnv,
  fallback: string,
): Promise<string> {
  try {
    // 先印換行把 rc 檔可能輸出的雜訊隔開，只取最後一行
    const out = await run(shell, ['-lic', 'printf "\\n%s\\n" "$CLAUDE_CONFIG_DIR"'], {
      env: { ...env, TERM: 'dumb' },
      timeoutMs: SHELL_PROBE_TIMEOUT_MS,
    })
    const lines = out
      .split('\n')
      .map((line) => line.replace(ANSI_ESCAPE, '').trim())
      .filter(Boolean)
    const last = lines[lines.length - 1]
    if (last && path.isAbsolute(last)) return last
    return fallback
  } catch (err) {
    console.warn('[scan-deps] 探測 CLAUDE_CONFIG_DIR 失敗，改用預設設定目錄', { shell, fallback, err })
    return fallback
  }
}
