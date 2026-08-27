import { homedir } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow, app } from 'electron'
import * as nodePty from 'node-pty'
import { BoardStore } from './board-store'
import { PtyManager } from './pty-manager'
import { registerIpc } from './ipc'

const boardFile = join(homedir(), '.sharkcommand', 'board.json')
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

void app.whenReady().then(() => {
  registerIpc(store, ptyManager, () => mainWindow)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
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
