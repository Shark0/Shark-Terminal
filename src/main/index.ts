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
  if (cleaningUp) return
  event.preventDefault()
  cleaningUp = true
  void (async () => {
    try {
      await store.flush()
      await ptyManager.killAll()
    } catch (err) {
      console.error('[main] 結束前清理失敗，仍繼續關閉', { err })
    }
    app.quit()
  })()
})
