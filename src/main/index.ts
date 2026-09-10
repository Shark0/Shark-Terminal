import { homedir } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow, app } from 'electron'
import * as nodePty from 'node-pty'
import { BoardStore } from './board-store'
import { stripInheritedEnv } from './inherited-env'
import { PtyManager } from './pty-manager'
import { createNodeScanDeps, probeClaudeConfigDir } from './scan-deps'
import { SessionScanner } from './session-scan'
import { registerIpc } from './ipc'

// 先洗掉「這個 app 是從哪裡啟動的」，下面每一處讀 process.env 的地方才拿得到乾淨環境
stripInheritedEnv(process.env)

// dev 模式執行的是 Electron.app bundle，macOS 選單列會顯示 "Electron"。
// 明確設定名稱讓選單列與「關於」視窗顯示正確的 app 名稱。
app.setName('Shark Terminal')

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)
// dev 用獨立看板檔，避免與正在使用中的正式版互相覆寫
const boardFile = join(homedir(), '.sharkterminal', isDev ? 'board.dev.json' : 'board.json')
const store = new BoardStore(boardFile)

const ptyManager = new PtyManager((opts) =>
  nodePty.spawn(opts.file, opts.args, {
    name: 'xterm-256color',
    cwd: opts.cwd,
    cols: opts.cols,
    rows: opts.rows,
    env: opts.env as Record<string, string>,
  }),
)

/** session 掃描間隔：Claude 跑指令的子程序是暫時性的，太慢會漏掉；ps + lsof 一輪約 70ms */
const SESSION_SCAN_INTERVAL_MS = 3000

// Claude Code 的設定目錄可用 CLAUDE_CONFIG_DIR 改，session 狀態檔跟著它走。
// 從 Finder / Dock 啟動時 process.env 沒有 rc 檔的 export，先用預設值讓掃描器能立刻開工，
// 再用 login shell 探測一次（與卡片內 shell 讀同一套 rc）；探測結果出來前只是暫時讀不到 session 檔
let claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
const scanner = new SessionScanner(() => ptyManager.entries(), createNodeScanDeps(() => claudeConfigDir))
if (!process.env.CLAUDE_CONFIG_DIR) {
  void probeClaudeConfigDir(process.env.SHELL || '/bin/zsh', process.env, claudeConfigDir).then((dir) => {
    claudeConfigDir = dir
  })
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d1117',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    // dev 模式把 renderer 的 console 轉印到 main 的 stdout，
    // 否則在沒有 GUI 的環境完全看不到 renderer 端的錯誤
    mainWindow.webContents.on('console-message', (details) => {
      console.log(`[renderer:${details.level}] ${details.message}  (${details.sourceId}:${details.lineNumber})`)
    })
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 兩個實例會各自持有記憶體中的 board 並互相覆蓋 ~/.sharkterminal/board.json，
// 造成資料遺失。第二個實例直接退出，並把既有視窗帶到前景。
//
// dev 模式下 electron-vite 熱重啟時會短暫存在新舊兩個實例，
// 新實例會因為拿不到鎖而直接退出，導致改一次 main 程序整個 app 就關掉。
// 單一實例保護只有打包後的正式版需要。
if (!isDev && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
}

void app.whenReady().then(() => {
  registerIpc(store, ptyManager, scanner, () => mainWindow)
  scanner.start(SESSION_SCAN_INTERVAL_MS)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // 單視窗 app：關窗即結束，走 before-quit 的完整清理（flush board + killAll pty）
  app.quit()
})

// 結束前先把待寫入的看板落地，再關掉所有 pty
let cleaningUp = false
app.on('before-quit', (event) => {
  if (cleaningUp) {
    // 清理進行中：一律攔截，退出完全交給清理完成後的 app.exit()，
    // 否則使用者連按 ⌘Q 會搶在 flush 寫完之前退出
    event.preventDefault()
    return
  }
  event.preventDefault()
  cleaningUp = true
  scanner.stop()
  void (async () => {
    try {
      await store.flush()
      await ptyManager.killAll()
    } catch (err) {
      console.error('[main] 結束前清理失敗，仍繼續關閉', { err })
    }
    // 用 app.exit() 直接結束，避免再次觸發 before-quit——
    // 若改用 app.quit()，使用者在 flush/killAll 跑完前又按一次 ⌘Q 時，
    // 第二次 before-quit 不會被攔截，有機會搶在清理完成前真的退出
    app.exit()
  })()
})
