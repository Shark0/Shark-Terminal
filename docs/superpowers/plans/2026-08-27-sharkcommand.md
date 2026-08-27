# SharkCommand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一個 macOS 桌面應用，以 Trello 式看板管理多個 Claude Code session — 欄位代表工作階段、卡片代表一個內嵌終端機 session，可拖拉跨欄推進階段。

**Architecture:** Electron 三程序架構。main 程序獨佔所有 pty 實例、`board.json` 持久化與 git branch 讀取；preload 以 `contextBridge` 暴露型別化 IPC；renderer 跑 React 看板與 xterm.js。核心約束是 xterm 實例存放於 module-level Map 並常駐，與 React 元件樹解耦，因此拖拉卡片不會影響終端機。

**Tech Stack:** Electron + electron-vite、React 18 + TypeScript、xterm.js + node-pty、@dnd-kit、zustand、Tailwind、Vitest、electron-builder

**Spec:** `docs/superpowers/specs/2026-08-27-sharkcommand-design.md`

## Global Constraints

- **Node 版本**：≥ 20（electron-vite 與 Electron 30+ 需求）
- **Electron 安全設定**：一律 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: false`（preload 需 require `electron`）
- **renderer 不得 import Node 模組**：`node-pty`、`fs`、`path` 只能出現在 `src/main/**`
- **所有 UI 文字、程式碼註解、logger 訊息使用繁體中文**；變數、函式、型別名稱維持英文
- **設定檔路徑**：`~/.sharkcommand/board.json`
- **debounce 常數**：board 存檔 500ms、terminal resize 100ms
- **狀態燈門檻**：最近 2000ms 內有 output 為 `running`，否則 `idle`
- **pty 關閉流程**：SIGTERM → 等 500ms → SIGKILL
- **xterm scrollback**：5000 行
- **過場動畫**：≤150ms（狀態燈呼吸動畫 2s 週期不受此限）
- **打包**：electron-builder 產出 universal binary `.dmg`
- **錯誤記錄**：所有 catch block、以及 `switch` / `if-else` 的 fallback 分支，必須以 `console.warn` 或 `console.error` 記錄上下文，訊息格式 `[模組名] 繁體中文說明`，並帶上原始 error

## 視覺 Token（所有 UI 任務共用）

| 用途 | 值 |
|---|---|
| 底層背景 | `#0d1117` |
| 欄位背景 | `#161b22` |
| 卡片背景 | `#1c2128` |
| 卡片 border | `#30363d` |
| 卡片 hover border | `#484f58` |
| 主要文字 | `#e6edf3` |
| 次要文字 | `#8b949e` |
| running 燈 | `#3fb950` |
| idle 燈 | `#d29922` |
| stopped 燈 | `#6e7681` |
| 欄位色盤 | `#58a6ff` `#3fb950` `#bc8cff` `#d29922` `#f778ba` `#39c5cf` |
| UI 字體 | `-apple-system, "SF Pro Text", sans-serif` |
| 終端機字體 | `"SF Mono", Menlo, monospace` |
| 卡片圓角 | `8px` |
| 卡片間距 | `8px` |

## 檔案結構

```
src/
├─ shared/
│  ├─ types.ts             Board / Column / Card / PtyStatus / GcApi 型別
│  └─ factory.ts           newCard / newColumn / createDefaultBoard / pickColumnColor
├─ main/
│  ├─ index.ts             BrowserWindow、before-quit 清理
│  ├─ board-store.ts       board.json 讀寫、debounce、損毀容錯
│  ├─ git.ts               readBranch（含 worktree / detached HEAD）
│  ├─ pty-manager.ts       所有 pty 的唯一擁有者
│  └─ ipc.ts               IPC channel 註冊
├─ preload/
│  └─ index.ts             contextBridge 暴露 window.gc
└─ renderer/
   ├─ main.tsx             React 進入點
   ├─ App.tsx              BoardPane + Splitter + TerminalPane
   ├─ store/
   │  ├─ board-reducer.ts  純函式：看板所有變更（TDD 核心）
   │  └─ app-store.ts      zustand：board + activeCardId + ptyStatus + branches
   ├─ board/
   │  ├─ BoardPane.tsx     欄位橫向容器 + DndContext
   │  ├─ Column.tsx        單一欄位
   │  ├─ ColumnHeader.tsx  色帶、標題、卡片數
   │  ├─ CardItem.tsx      卡片（狀態燈、cwd、branch）
   │  └─ CardDialog.tsx    新增／編輯卡片表單
   ├─ terminal/
   │  ├─ terminal-registry.ts  module-level Map<cardId, Terminal>
   │  ├─ TerminalPane.tsx      header + host
   │  ├─ TerminalHeader.tsx    標題、cwd、branch、啟動/重啟/停止
   │  └─ TerminalHost.tsx      ★ 所有 xterm 容器掛載處
   ├─ Splitter.tsx         可拖曳分隔線
   └─ CommandPalette.tsx   ⌘K 快速跳轉

tests/
├─ shared/factory.test.ts
├─ main/git.test.ts
├─ main/board-store.test.ts
├─ main/pty-manager.test.ts
└─ renderer/board-reducer.test.ts
```

## 任務總覽

| # | 任務 | 交付 |
|---|---|---|
| 1 | 專案骨架、共用型別、預設看板 | `npm run dev` 開得起空白視窗，`npm test` 綠燈 |
| 2 | board reducer（純函式） | 看板所有變更邏輯，測試完整覆蓋 |
| 3 | git branch 讀取 | 一般 repo / worktree / detached / 非 repo 皆正確 |
| 4 | board-store 持久化 | 讀寫、debounce、損毀容錯 |
| 5 | pty-manager | spawn / write / resize / kill / killAll |
| 6 | IPC + preload + main window | renderer 可呼叫 `window.gc` 全部 API |
| 7 | 看板 UI（無拖拉） | 看得到預設四欄，可增刪改欄位與卡片 |
| 8 | 拖拉 | 卡片跨欄、卡片重排、欄位重排 |
| 9 | 終端機面板 + Splitter | 點卡片可啟動 Claude 並正常互動 |
| 10 | 狀態燈 + git branch 顯示 | 卡片顯示 running/idle/stopped 與 branch |
| 11 | ⌘K + 打包 + README | 產出可分發的 universal `.dmg` |

---

### Task 1: 專案骨架、共用型別、預設看板

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `vitest.config.ts`
- Create: `tsconfig.json`, `tsconfig.node.json`
- Create: `tailwind.config.mjs`, `postcss.config.mjs`
- Create: `src/shared/types.ts`, `src/shared/factory.ts`
- Create: `src/main/index.ts`, `src/preload/index.ts`
- Create: `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/styles/index.css`
- Test: `tests/shared/factory.test.ts`

**Interfaces:**
- Consumes: 無（第一個任務）
- Produces:
  - `Card { id, title, cwd, command, note, createdAt, updatedAt }`（全為 `string`）
  - `Column { id: string, title: string, color: string, cardIds: string[] }`
  - `Board { version: 1, columns: Column[], cards: Record<string, Card> }`
  - `PtyStatus = 'running' | 'idle' | 'stopped'`
  - `BoardLoadResult { board: Board; recoveredFrom: string | null }`
  - `GcApi`（含 `homeDir(): string`）
  - `COLUMN_COLORS: readonly string[]`
  - `newCard(input: { title, cwd, command, note? }, id: string, now: string): Card`
  - `newColumn(title: string, color: string, id: string): Column`
  - `pickColumnColor(existing: Column[]): string`
  - `createDefaultBoard(genId: () => string): Board`
  - `DEFAULT_COLUMN_TITLES: readonly string[]`

- [ ] **Step 1: 建立 package.json**

```json
{
  "name": "sharkcommand",
  "version": "0.1.0",
  "description": "Trello 式看板管理多個 Claude Code session",
  "main": "./out/main/index.js",
  "author": "shark",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "build:mac": "npm run build && electron-builder --mac --universal",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json"
  }
}
```

`postinstall` 先不要寫進去 —— 第一次 `npm install` 時 `electron-builder` 還沒安裝，postinstall 會失敗並讓整個 install 中止。Step 2 末尾才補上。

- [ ] **Step 2: 安裝依賴**

`node-pty` 是 native addon，必須放 `dependencies` 才會被打包；其餘 renderer 依賴會被 bundle。`postinstall` 的 `install-app-deps` 會把 `node-pty` rebuild 成 Electron 的 ABI，缺這步 app 啟動時會出現 `NODE_MODULE_VERSION` 不符錯誤。

**React 必須釘在 18。** React 19 的型別移除了全域 `JSX` namespace，而本計畫所有元件都以 `JSX.Element` 標註回傳型別；裝到 19 會讓每個元件檔都出現 `找不到命名空間 JSX` 的型別錯誤。

```bash
npm install node-pty
npm install react@18 react-dom@18 zustand @xterm/xterm @xterm/addon-fit @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
npm install -D electron electron-vite electron-builder vite @vitejs/plugin-react typescript vitest
npm install -D @types/react@18 @types/react-dom@18 @types/node
npm install -D tailwindcss postcss autoprefixer
```

全部裝完後，才把 `postinstall` 補進 `package.json` 的 `scripts`，並手動執行一次：

```bash
npm pkg set scripts.postinstall="electron-builder install-app-deps"
npx electron-builder install-app-deps
```

這一步把 `node-pty` 重新編譯成 Electron 的 ABI。缺這步，app 啟動時會出現 `NODE_MODULE_VERSION` 不符而無法載入 `node-pty`。

- [ ] **Step 3: 建立建置設定檔**

`electron.vite.config.ts`：

```ts
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// main / preload / renderer 三端都要能 import @shared，缺任一端 build 會失敗
const alias = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    plugins: [react()],
  },
})
```

`vitest.config.ts`：

```ts
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
})
```

兩份獨立的 tsconfig，不使用 project references —— `composite: true` 與 `noEmit: true` 是 TypeScript 明文禁止的組合（`Composite projects may not disable emit`），而我們只做型別檢查、不需要 emit。

`tsconfig.json`（renderer，同時作為編輯器的預設設定）：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src/renderer/**/*.ts", "src/renderer/**/*.tsx", "src/shared/**/*.ts"]
}
```

`tsconfig.node.json`（main + preload + 測試）：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src/main/**/*.ts", "src/preload/**/*.ts", "src/shared/**/*.ts", "tests/**/*.ts", "*.config.ts"]
}
```

測試檔會 import `src/renderer/` 底下的純邏輯模組（Task 2 的 reducer、Task 10 的 pty-activity、Task 11 的 fuzzy）。這些模組不碰 DOM，在 node 設定下型別檢查通過沒有問題。

`tailwind.config.mjs` — 視覺 token 集中在此，後續 UI 任務一律引用這些名稱，不寫死色碼：

```js
export default {
  content: ['./src/renderer/**/*.{html,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#0d1117',
        column: '#161b22',
        card: '#1c2128',
        line: '#30363d',
        'line-hover': '#484f58',
        fg: '#e6edf3',
        'fg-dim': '#8b949e',
        running: '#3fb950',
        idle: '#d29922',
        stopped: '#6e7681',
      },
      fontFamily: {
        ui: ['-apple-system', 'SF Pro Text', 'sans-serif'],
        mono: ['SF Mono', 'Menlo', 'monospace'],
      },
      transitionDuration: { DEFAULT: '150ms' },
    },
  },
}
```

`postcss.config.mjs`：

```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } }
```

- [ ] **Step 4: 撰寫共用型別**

`src/shared/types.ts`：

```ts
export interface Card {
  id: string
  title: string
  cwd: string
  command: string
  note: string
  createdAt: string
  updatedAt: string
}

export interface Column {
  id: string
  title: string
  color: string
  cardIds: string[]
}

export interface Board {
  version: 1
  columns: Column[]
  cards: Record<string, Card>
}

/** running：2 秒內有 output；idle：pty 存活但無 output；stopped：pty 不存在或已結束 */
export type PtyStatus = 'running' | 'idle' | 'stopped'

/** 新增欄位時依序循環取色 */
export const COLUMN_COLORS = [
  '#58a6ff',
  '#3fb950',
  '#bc8cff',
  '#d29922',
  '#f778ba',
  '#39c5cf',
] as const

export interface BoardLoadResult {
  board: Board
  /** 非 null 代表原檔損毀已被備份，值為備份檔路徑，供 UI 提示使用 */
  recoveredFrom: string | null
}

/** preload 經 contextBridge 暴露到 window.gc 的完整介面 */
export interface GcApi {
  board: {
    load(): Promise<BoardLoadResult>
    save(board: Board): Promise<void>
  }
  pty: {
    spawn(cardId: string, cwd: string, command: string, cols: number, rows: number): Promise<void>
    write(cardId: string, data: string): void
    resize(cardId: string, cols: number, rows: number): void
    kill(cardId: string): void
  }
  onPtyData(cb: (cardId: string, data: string) => void): () => void
  onPtyExit(cb: (cardId: string, exitCode: number) => void): () => void
  git: {
    branch(cwd: string): Promise<string | null>
  }
  dialog: {
    pickDirectory(): Promise<string | null>
  }
  /** 家目錄路徑，用於把卡片的 cwd 縮寫成 ~ */
  homeDir(): string
}
```

- [ ] **Step 5: 撰寫失敗的測試**

`tests/shared/factory.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { COLUMN_COLORS } from '@shared/types'
import {
  DEFAULT_COLUMN_TITLES,
  createDefaultBoard,
  newCard,
  newColumn,
  pickColumnColor,
} from '@shared/factory'

function seqId(prefix: string): () => string {
  let n = 0
  return () => `${prefix}_${n++}`
}

describe('createDefaultBoard', () => {
  it('建立四個預設欄位，皆為空欄', () => {
    const board = createDefaultBoard(seqId('col'))
    expect(board.version).toBe(1)
    expect(board.columns.map((c) => c.title)).toEqual([
      '需求評估中',
      '開發中',
      'Review 中',
      '等待 Merge',
    ])
    expect(board.columns.every((c) => c.cardIds.length === 0)).toBe(true)
    expect(board.cards).toEqual({})
  })

  it('每個欄位取得唯一 id', () => {
    const board = createDefaultBoard(seqId('col'))
    const ids = board.columns.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('相鄰欄位顏色不同', () => {
    const board = createDefaultBoard(seqId('col'))
    for (let i = 1; i < board.columns.length; i++) {
      expect(board.columns[i].color).not.toBe(board.columns[i - 1].color)
    }
  })
})

describe('pickColumnColor', () => {
  it('依既有欄位數量取色', () => {
    expect(pickColumnColor([])).toBe(COLUMN_COLORS[0])
    expect(pickColumnColor([newColumn('a', COLUMN_COLORS[0], 'c0')])).toBe(COLUMN_COLORS[1])
  })

  it('超過色盤長度後循環', () => {
    const full = COLUMN_COLORS.map((color, i) => newColumn(`c${i}`, color, `id${i}`))
    expect(pickColumnColor(full)).toBe(COLUMN_COLORS[0])
  })
})

describe('newCard', () => {
  it('note 未提供時為空字串，兩個時間戳相同', () => {
    const card = newCard(
      { title: 'U19 登入重構', cwd: '/tmp/u19', command: 'claude' },
      'card_1',
      '2026-08-27T00:00:00.000Z',
    )
    expect(card).toEqual({
      id: 'card_1',
      title: 'U19 登入重構',
      cwd: '/tmp/u19',
      command: 'claude',
      note: '',
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:00.000Z',
    })
  })

  it('note 有提供時保留', () => {
    const card = newCard(
      { title: 'T', cwd: '/tmp', command: 'claude', note: '記得跑 migration' },
      'card_2',
      '2026-08-27T00:00:00.000Z',
    )
    expect(card.note).toBe('記得跑 migration')
  })
})

describe('newColumn', () => {
  it('新欄位不含任何卡片', () => {
    expect(newColumn('開發中', '#3fb950', 'col_9')).toEqual({
      id: 'col_9',
      title: '開發中',
      color: '#3fb950',
      cardIds: [],
    })
  })
})

describe('DEFAULT_COLUMN_TITLES', () => {
  it('與 spec 定義的四個階段一致', () => {
    expect(DEFAULT_COLUMN_TITLES).toEqual(['需求評估中', '開發中', 'Review 中', '等待 Merge'])
  })
})
```

- [ ] **Step 6: 執行測試，確認失敗**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "@shared/factory"`（檔案尚未建立）

- [ ] **Step 7: 實作 factory**

`src/shared/factory.ts`：

```ts
import { COLUMN_COLORS, type Board, type Card, type Column } from './types'

/** spec 定義的四個預設工作階段 */
export const DEFAULT_COLUMN_TITLES = ['需求評估中', '開發中', 'Review 中', '等待 Merge'] as const

export function newCard(
  input: { title: string; cwd: string; command: string; note?: string },
  id: string,
  now: string,
): Card {
  return {
    id,
    title: input.title,
    cwd: input.cwd,
    command: input.command,
    note: input.note ?? '',
    createdAt: now,
    updatedAt: now,
  }
}

export function newColumn(title: string, color: string, id: string): Column {
  return { id, title, color, cardIds: [] }
}

/** 依既有欄位數量從色盤循環取色，確保相鄰欄位不同色 */
export function pickColumnColor(existing: Column[]): string {
  return COLUMN_COLORS[existing.length % COLUMN_COLORS.length]
}

/** board.json 不存在時使用的初始看板 */
export function createDefaultBoard(genId: () => string): Board {
  const columns: Column[] = []
  for (const title of DEFAULT_COLUMN_TITLES) {
    columns.push(newColumn(title, pickColumnColor(columns), genId()))
  }
  return { version: 1, columns, cards: {} }
}
```

- [ ] **Step 8: 執行測試，確認通過**

Run: `npm test`
Expected: PASS — 9 個測試全綠

- [ ] **Step 9: 建立最小可執行的 Electron 骨架**

此步驟只求視窗開得起來，實質功能在 Task 6 補上。

`src/main/index.ts`：

```ts
import { join } from 'node:path'
import { BrowserWindow, app } from 'electron'

function createWindow(): void {
  const win = new BrowserWindow({
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

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

`src/preload/index.ts`（Task 6 會填入實際 API）：

```ts
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('gc', {})
```

`src/renderer/index.html`：

```html
<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'" />
    <title>SharkCommand</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`src/renderer/styles/index.css`：

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html,
body,
#root {
  height: 100%;
  margin: 0;
  overflow: hidden;
}

body {
  background: theme('colors.base');
  color: theme('colors.fg');
  font-family: theme('fontFamily.ui');
}
```

`src/renderer/main.tsx`：

```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/index.css'

const container = document.getElementById('root')
if (!container) throw new Error('[renderer] 找不到 #root 掛載點')

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

`src/renderer/App.tsx`：

```tsx
export default function App(): JSX.Element {
  return (
    <div className="flex h-full items-center justify-center text-fg-dim">
      SharkCommand
    </div>
  )
}
```

- [ ] **Step 10: 驗證開發環境可啟動**

Run: `npm run dev`
Expected: Electron 視窗開啟，深色背景，畫面中央顯示「SharkCommand」。確認後 ⌘Q 關閉。

Run: `npm run typecheck`
Expected: 無錯誤

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: 專案骨架、共用型別與預設看板

electron-vite 三端建置、Tailwind 視覺 token、Vitest。
factory 提供 newCard / newColumn / createDefaultBoard，
預設看板含需求評估中／開發中／Review 中／等待 Merge 四欄。"
```

---

### Task 2: board reducer（純函式）

看板所有變更邏輯集中在此，全為純函式（不產生 id、不讀時鐘），因此測試零 mock。所有 id 與時間戳由呼叫端提供。

**Files:**
- Create: `src/renderer/store/board-reducer.ts`
- Test: `tests/renderer/board-reducer.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Board` / `Card` / `Column` 型別、`createDefaultBoard` / `newCard` / `newColumn`
- Produces:
  - `CardPatch = Partial<Pick<Card, 'title' | 'cwd' | 'command' | 'note'>>`
  - `ColumnPatch = Partial<Pick<Column, 'title' | 'color'>>`
  - `addCard(board: Board, columnId: string, card: Card): Board`
  - `updateCard(board: Board, cardId: string, patch: CardPatch, now: string): Board`
  - `deleteCard(board: Board, cardId: string): Board`
  - `moveCard(board: Board, cardId: string, toColumnId: string, toIndex: number): Board`
  - `addColumn(board: Board, column: Column): Board`
  - `updateColumn(board: Board, columnId: string, patch: ColumnPatch): Board`
  - `deleteColumn(board: Board, columnId: string): { board: Board; removedCardIds: string[] }`
  - `moveColumn(board: Board, columnId: string, toIndex: number): Board`

**`toIndex` 的語意（`moveCard` 與 `moveColumn` 共用，務必照此實作）：** 目標項目**自原位置移除之後**，於目標陣列中的插入索引。與 `@dnd-kit` 的 `arrayMove` 一致，Task 8 會直接把 dnd-kit 給的索引傳進來。超出範圍自動 clamp 到合法區間。

- [ ] **Step 1: 撰寫失敗的測試**

`tests/renderer/board-reducer.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'
import type { Board } from '@shared/types'
import { createDefaultBoard, newCard, newColumn } from '@shared/factory'
import {
  addCard,
  addColumn,
  deleteCard,
  deleteColumn,
  moveCard,
  moveColumn,
  updateCard,
  updateColumn,
} from '../../src/renderer/store/board-reducer'

const NOW = '2026-08-27T00:00:00.000Z'
const LATER = '2026-08-27T09:30:00.000Z'

function seqId(prefix: string): () => string {
  let n = 0
  return () => `${prefix}_${n++}`
}

function card(id: string, title = id): ReturnType<typeof newCard> {
  return newCard({ title, cwd: `/tmp/${id}`, command: 'claude' }, id, NOW)
}

/** col_0 需求評估中[card_a, card_b] / col_1 開發中[card_c] / col_2 Review 中[] / col_3 等待 Merge[] */
function fixture(): Board {
  let b = createDefaultBoard(seqId('col'))
  b = addCard(b, 'col_0', card('card_a'))
  b = addCard(b, 'col_0', card('card_b'))
  b = addCard(b, 'col_1', card('card_c'))
  return b
}

function idsOf(board: Board, columnId: string): string[] {
  const column = board.columns.find((c) => c.id === columnId)
  if (!column) throw new Error(`測試 fixture 找不到欄位 ${columnId}`)
  return column.cardIds
}

describe('addCard', () => {
  it('把卡片加到指定欄位的末端', () => {
    const b = addCard(fixture(), 'col_1', card('card_z'))
    expect(idsOf(b, 'col_1')).toEqual(['card_c', 'card_z'])
    expect(b.cards.card_z.title).toBe('card_z')
  })

  it('欄位不存在時原樣回傳並記錄警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const before = fixture()
    const after = addCard(before, 'col_nope', card('card_z'))
    expect(after).toBe(before)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('updateCard', () => {
  it('套用 patch 並更新 updatedAt，不動 createdAt', () => {
    const b = updateCard(fixture(), 'card_a', { title: '改過的標題' }, LATER)
    expect(b.cards.card_a.title).toBe('改過的標題')
    expect(b.cards.card_a.cwd).toBe('/tmp/card_a')
    expect(b.cards.card_a.createdAt).toBe(NOW)
    expect(b.cards.card_a.updatedAt).toBe(LATER)
  })

  it('卡片不存在時原樣回傳', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const before = fixture()
    expect(updateCard(before, 'card_nope', { title: 'x' }, LATER)).toBe(before)
    warn.mockRestore()
  })
})

describe('deleteCard', () => {
  it('同時自 cards 與所屬欄位移除', () => {
    const b = deleteCard(fixture(), 'card_a')
    expect(b.cards.card_a).toBeUndefined()
    expect(idsOf(b, 'col_0')).toEqual(['card_b'])
  })
})

describe('moveCard', () => {
  it('跨欄移動到指定索引', () => {
    const b = moveCard(fixture(), 'card_a', 'col_1', 0)
    expect(idsOf(b, 'col_0')).toEqual(['card_b'])
    expect(idsOf(b, 'col_1')).toEqual(['card_a', 'card_c'])
  })

  it('跨欄移動到空欄', () => {
    const b = moveCard(fixture(), 'card_a', 'col_2', 0)
    expect(idsOf(b, 'col_0')).toEqual(['card_b'])
    expect(idsOf(b, 'col_2')).toEqual(['card_a'])
  })

  it('同欄往下移動：索引為移除後的位置', () => {
    const b = moveCard(fixture(), 'card_a', 'col_0', 1)
    expect(idsOf(b, 'col_0')).toEqual(['card_b', 'card_a'])
  })

  it('同欄往上移動', () => {
    const b = moveCard(fixture(), 'card_b', 'col_0', 0)
    expect(idsOf(b, 'col_0')).toEqual(['card_b', 'card_a'])
  })

  it('拖回原位時內容不變', () => {
    const b = moveCard(fixture(), 'card_a', 'col_0', 0)
    expect(idsOf(b, 'col_0')).toEqual(['card_a', 'card_b'])
  })

  it('toIndex 超出上界時 clamp 到末端', () => {
    const b = moveCard(fixture(), 'card_a', 'col_1', 99)
    expect(idsOf(b, 'col_1')).toEqual(['card_c', 'card_a'])
  })

  it('toIndex 為負數時 clamp 到開頭', () => {
    const b = moveCard(fixture(), 'card_a', 'col_1', -5)
    expect(idsOf(b, 'col_1')).toEqual(['card_a', 'card_c'])
  })

  it('卡片不存在時原樣回傳', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const before = fixture()
    expect(moveCard(before, 'card_nope', 'col_1', 0)).toBe(before)
    warn.mockRestore()
  })

  it('目標欄位不存在時原樣回傳', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const before = fixture()
    expect(moveCard(before, 'card_a', 'col_nope', 0)).toBe(before)
    warn.mockRestore()
  })
})

describe('addColumn / updateColumn', () => {
  it('新欄位加在最右側', () => {
    const b = addColumn(fixture(), newColumn('已上線', '#39c5cf', 'col_9'))
    expect(b.columns.map((c) => c.id)).toEqual(['col_0', 'col_1', 'col_2', 'col_3', 'col_9'])
  })

  it('更新欄位標題與顏色', () => {
    const b = updateColumn(fixture(), 'col_1', { title: '實作中', color: '#f778ba' })
    const column = b.columns.find((c) => c.id === 'col_1')
    expect(column?.title).toBe('實作中')
    expect(column?.color).toBe('#f778ba')
    expect(column?.cardIds).toEqual(['card_c'])
  })
})

describe('deleteColumn', () => {
  it('連帶刪除欄內卡片，並回傳被刪除的 cardIds', () => {
    const { board, removedCardIds } = deleteColumn(fixture(), 'col_0')
    expect(board.columns.map((c) => c.id)).toEqual(['col_1', 'col_2', 'col_3'])
    expect(board.cards.card_a).toBeUndefined()
    expect(board.cards.card_b).toBeUndefined()
    expect(board.cards.card_c).toBeDefined()
    expect(removedCardIds).toEqual(['card_a', 'card_b'])
  })

  it('刪除空欄時 removedCardIds 為空陣列', () => {
    const { removedCardIds } = deleteColumn(fixture(), 'col_2')
    expect(removedCardIds).toEqual([])
  })
})

describe('moveColumn', () => {
  it('把欄位移到最前', () => {
    const b = moveColumn(fixture(), 'col_2', 0)
    expect(b.columns.map((c) => c.id)).toEqual(['col_2', 'col_0', 'col_1', 'col_3'])
  })

  it('把欄位移到最後', () => {
    const b = moveColumn(fixture(), 'col_0', 3)
    expect(b.columns.map((c) => c.id)).toEqual(['col_1', 'col_2', 'col_3', 'col_0'])
  })

  it('欄位隨身帶著自己的卡片', () => {
    const b = moveColumn(fixture(), 'col_0', 3)
    expect(idsOf(b, 'col_0')).toEqual(['card_a', 'card_b'])
  })
})

describe('不變性', () => {
  it('所有 reducer 都不修改輸入的 board', () => {
    const board = fixture()
    const snapshot = structuredClone(board)

    addCard(board, 'col_0', card('card_z'))
    updateCard(board, 'card_a', { title: 'x' }, LATER)
    deleteCard(board, 'card_a')
    moveCard(board, 'card_a', 'col_1', 0)
    addColumn(board, newColumn('x', '#58a6ff', 'col_9'))
    updateColumn(board, 'col_0', { title: 'x' })
    deleteColumn(board, 'col_0')
    moveColumn(board, 'col_0', 2)

    expect(board).toEqual(snapshot)
  })
})
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -- board-reducer`
Expected: FAIL — 無法解析 `../../src/renderer/store/board-reducer`

- [ ] **Step 3: 實作 reducer**

`src/renderer/store/board-reducer.ts`：

```ts
import type { Board, Card, Column } from '@shared/types'

export type CardPatch = Partial<Pick<Card, 'title' | 'cwd' | 'command' | 'note'>>
export type ColumnPatch = Partial<Pick<Column, 'title' | 'color'>>

export function addCard(board: Board, columnId: string, card: Card): Board {
  const index = board.columns.findIndex((c) => c.id === columnId)
  if (index === -1) {
    console.warn('[board-reducer] addCard 找不到目標欄位，忽略此次新增', {
      columnId,
      cardId: card.id,
    })
    return board
  }
  const columns = board.columns.map((c, i) =>
    i === index ? { ...c, cardIds: [...c.cardIds, card.id] } : c,
  )
  return { ...board, columns, cards: { ...board.cards, [card.id]: card } }
}

export function updateCard(board: Board, cardId: string, patch: CardPatch, now: string): Board {
  const existing = board.cards[cardId]
  if (!existing) {
    console.warn('[board-reducer] updateCard 找不到卡片，忽略此次更新', { cardId })
    return board
  }
  return {
    ...board,
    cards: { ...board.cards, [cardId]: { ...existing, ...patch, updatedAt: now } },
  }
}

export function deleteCard(board: Board, cardId: string): Board {
  if (!board.cards[cardId]) {
    console.warn('[board-reducer] deleteCard 找不到卡片，忽略此次刪除', { cardId })
    return board
  }
  const cards = { ...board.cards }
  delete cards[cardId]
  const columns = board.columns.map((c) =>
    c.cardIds.includes(cardId) ? { ...c, cardIds: c.cardIds.filter((id) => id !== cardId) } : c,
  )
  return { ...board, columns, cards }
}

/**
 * 移動卡片到目標欄位的指定位置。
 * toIndex 為「卡片自原位置移除之後」於目標欄位的插入索引，與 @dnd-kit 的 arrayMove 一致。
 * 同欄移動也走同一條路徑，索引語意才會一致。
 */
export function moveCard(board: Board, cardId: string, toColumnId: string, toIndex: number): Board {
  if (!board.cards[cardId]) {
    console.warn('[board-reducer] moveCard 找不到卡片，忽略此次移動', { cardId })
    return board
  }
  const toColumnIndex = board.columns.findIndex((c) => c.id === toColumnId)
  if (toColumnIndex === -1) {
    console.warn('[board-reducer] moveCard 找不到目標欄位，忽略此次移動', { cardId, toColumnId })
    return board
  }

  const columns = board.columns.map((c) => ({
    ...c,
    cardIds: c.cardIds.filter((id) => id !== cardId),
  }))
  const target = columns[toColumnIndex]
  const index = Math.max(0, Math.min(toIndex, target.cardIds.length))
  const cardIds = [...target.cardIds]
  cardIds.splice(index, 0, cardId)
  columns[toColumnIndex] = { ...target, cardIds }

  return { ...board, columns }
}

export function addColumn(board: Board, column: Column): Board {
  return { ...board, columns: [...board.columns, column] }
}

export function updateColumn(board: Board, columnId: string, patch: ColumnPatch): Board {
  const index = board.columns.findIndex((c) => c.id === columnId)
  if (index === -1) {
    console.warn('[board-reducer] updateColumn 找不到欄位，忽略此次更新', { columnId })
    return board
  }
  return {
    ...board,
    columns: board.columns.map((c, i) => (i === index ? { ...c, ...patch } : c)),
  }
}

/**
 * 刪除欄位並連帶刪除其中所有卡片。
 * removedCardIds 供呼叫端 kill 對應的 pty 與清除 xterm 實例。
 */
export function deleteColumn(
  board: Board,
  columnId: string,
): { board: Board; removedCardIds: string[] } {
  const column = board.columns.find((c) => c.id === columnId)
  if (!column) {
    console.warn('[board-reducer] deleteColumn 找不到欄位，忽略此次刪除', { columnId })
    return { board, removedCardIds: [] }
  }
  const cards = { ...board.cards }
  for (const id of column.cardIds) delete cards[id]
  return {
    board: { ...board, columns: board.columns.filter((c) => c.id !== columnId), cards },
    removedCardIds: [...column.cardIds],
  }
}

/** toIndex 語意同 moveCard：該欄位自原位置移除之後的插入索引 */
export function moveColumn(board: Board, columnId: string, toIndex: number): Board {
  const from = board.columns.findIndex((c) => c.id === columnId)
  if (from === -1) {
    console.warn('[board-reducer] moveColumn 找不到欄位，忽略此次移動', { columnId })
    return board
  }
  const columns = [...board.columns]
  const [moved] = columns.splice(from, 1)
  const index = Math.max(0, Math.min(toIndex, columns.length))
  columns.splice(index, 0, moved)
  return { ...board, columns }
}
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test`
Expected: PASS — Task 1 的 9 個加上本任務 22 個測試全綠

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: board reducer 純函式

卡片與欄位的新增／更新／刪除／移動全部集中於此。
toIndex 採移除後插入索引語意，與 @dnd-kit arrayMove 對齊。
deleteColumn 回傳 removedCardIds 供呼叫端清理 pty。"
```

---

### Task 3: git branch 讀取

**Files:**
- Create: `src/main/git.ts`
- Test: `tests/main/git.test.ts`

**Interfaces:**
- Consumes: 無
- Produces: `readBranch(cwd: string): Promise<string | null>`
  - 一般 repo → branch 名稱（如 `feat/pbp`）
  - worktree（`.git` 為檔案）→ branch 名稱
  - detached HEAD → commit SHA 前 7 碼
  - 非 git 目錄 → `null`

不呼叫 `git` 指令，直接讀 `.git/HEAD`。原因是每張卡片都要讀，spawn 子程序的成本與延遲不划算；讀一個檔案是微秒級。

- [ ] **Step 1: 撰寫失敗的測試**

`tests/main/git.test.ts`：

```ts
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readBranch } from '../../src/main/git'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), 'sharkcommand-git-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

/** 建立一般 repo：<root>/<name>/.git/HEAD */
async function makeRepo(name: string, headContent: string): Promise<string> {
  const repo = path.join(root, name)
  await fs.mkdir(path.join(repo, '.git'), { recursive: true })
  await fs.writeFile(path.join(repo, '.git', 'HEAD'), headContent)
  return repo
}

describe('readBranch', () => {
  it('一般 repo 回傳 branch 名稱', async () => {
    const repo = await makeRepo('normal', 'ref: refs/heads/main\n')
    expect(await readBranch(repo)).toBe('main')
  })

  it('branch 名稱含斜線時完整回傳', async () => {
    const repo = await makeRepo('slash', 'ref: refs/heads/feat/pbp-refactor\n')
    expect(await readBranch(repo)).toBe('feat/pbp-refactor')
  })

  it('自子目錄往上尋找 .git', async () => {
    const repo = await makeRepo('nested', 'ref: refs/heads/develop\n')
    const deep = path.join(repo, 'src', 'main', 'kotlin')
    await fs.mkdir(deep, { recursive: true })
    expect(await readBranch(deep)).toBe('develop')
  })

  it('detached HEAD 回傳 SHA 前 7 碼', async () => {
    const repo = await makeRepo('detached', '9f2c1ab8e4d5c6b7a8091a2b3c4d5e6f70819234\n')
    expect(await readBranch(repo)).toBe('9f2c1ab')
  })

  it('worktree（.git 為檔案，絕對路徑）回傳 branch', async () => {
    const main = await makeRepo('wt-main', 'ref: refs/heads/main\n')
    const gitDir = path.join(main, '.git', 'worktrees', 'family-supporter')
    await fs.mkdir(gitDir, { recursive: true })
    await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/family-supporter\n')

    const wt = path.join(root, 'wt-family')
    await fs.mkdir(wt, { recursive: true })
    await fs.writeFile(path.join(wt, '.git'), `gitdir: ${gitDir}\n`)

    expect(await readBranch(wt)).toBe('family-supporter')
  })

  it('worktree 的 gitdir 為相對路徑時，相對於 .git 檔案所在目錄解析', async () => {
    const gitDir = path.join(root, 'shared-gitdir')
    await fs.mkdir(gitDir, { recursive: true })
    await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/hotfix\n')

    const wt = path.join(root, 'wt-relative')
    await fs.mkdir(wt, { recursive: true })
    await fs.writeFile(path.join(wt, '.git'), 'gitdir: ../shared-gitdir\n')

    expect(await readBranch(wt)).toBe('hotfix')
  })

  it('非 git 目錄回傳 null', async () => {
    const plain = path.join(root, 'plain')
    await fs.mkdir(plain, { recursive: true })
    expect(await readBranch(plain)).toBeNull()
  })

  it('目錄不存在時回傳 null', async () => {
    expect(await readBranch(path.join(root, '不存在的目錄'))).toBeNull()
  })

  it('HEAD 內容無法辨識時回傳 null', async () => {
    const repo = await makeRepo('garbage', '這不是有效的 HEAD 內容\n')
    expect(await readBranch(repo)).toBeNull()
  })

  it('worktree 的 gitdir 指向不存在的路徑時回傳 null', async () => {
    const wt = path.join(root, 'wt-broken')
    await fs.mkdir(wt, { recursive: true })
    await fs.writeFile(path.join(wt, '.git'), `gitdir: ${path.join(root, 'nope')}\n`)
    expect(await readBranch(wt)).toBeNull()
  })
})
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -- git`
Expected: FAIL — 無法解析 `../../src/main/git`

- [ ] **Step 3: 實作 git.ts**

`src/main/git.ts`：

```ts
import { promises as fs } from 'node:fs'
import path from 'node:path'

const BRANCH_REF = /^ref:\s*refs\/heads\/(.+)$/
const FULL_SHA = /^[0-9a-f]{40}$/
const GITDIR_LINE = /^gitdir:\s*(.+)$/

/** 自 cwd 逐層往上尋找 .git（檔案或目錄），找不到回傳 null */
async function findGitEntry(cwd: string): Promise<string | null> {
  let dir = path.resolve(cwd)
  for (;;) {
    const candidate = path.join(dir, '.git')
    try {
      await fs.stat(candidate)
      return candidate
    } catch {
      // 此層沒有 .git，繼續往上找；到根目錄仍找不到即非 repo
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** .git 為目錄時直接回傳；為檔案時解析其中的 gitdir 指向（支援相對路徑） */
async function resolveGitDir(gitEntry: string): Promise<string | null> {
  try {
    const stat = await fs.stat(gitEntry)
    if (stat.isDirectory()) return gitEntry

    const content = (await fs.readFile(gitEntry, 'utf8')).trim()
    const matched = content.match(GITDIR_LINE)
    if (!matched) {
      console.warn('[git] .git 為檔案但內容不含 gitdir，無法解析', { gitEntry, content })
      return null
    }
    const target = matched[1].trim()
    return path.isAbsolute(target) ? target : path.resolve(path.dirname(gitEntry), target)
  } catch (err) {
    console.warn('[git] 解析 .git 位置失敗', { gitEntry, err })
    return null
  }
}

/**
 * 讀取指定目錄所屬 repo 的當前 branch。
 * 直接讀 .git/HEAD 而非呼叫 git 指令——每張卡片都要讀，spawn 子程序的成本不划算。
 */
export async function readBranch(cwd: string): Promise<string | null> {
  const gitEntry = await findGitEntry(cwd)
  if (!gitEntry) return null

  const gitDir = await resolveGitDir(gitEntry)
  if (!gitDir) return null

  try {
    const head = (await fs.readFile(path.join(gitDir, 'HEAD'), 'utf8')).trim()

    const branch = head.match(BRANCH_REF)
    if (branch) return branch[1]

    if (FULL_SHA.test(head)) return head.slice(0, 7)

    console.warn('[git] HEAD 內容無法辨識，視為無 branch', { gitDir, head })
    return null
  } catch (err) {
    console.warn('[git] 讀取 HEAD 失敗', { gitDir, err })
    return null
  }
}
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -- git`
Expected: PASS — 10 個測試全綠

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 讀取 git branch

直接讀 .git/HEAD 而非 spawn git 指令。
支援一般 repo、worktree（含相對路徑 gitdir）、
detached HEAD（顯示 SHA 前 7 碼）與非 repo 目錄。"
```

---

### Task 4: board-store 持久化

**Files:**
- Create: `src/main/board-store.ts`
- Test: `tests/main/board-store.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Board` 型別與 `createDefaultBoard`
- Produces:
  - `isValidBoard(value: unknown): value is Board`
  - `reconcile(board: Board): Board` — 修復 `cardIds` 指向不存在卡片、以及不屬於任何欄位的孤兒卡片
  - `class BoardStore`
    - `constructor(filePath: string, genId?: () => string, debounceMs?: number)`
    - `load(): Promise<BoardLoadResult>` — `{ board, recoveredFrom }`，`recoveredFrom` 非 null 代表原檔損毀已備份
    - `save(board: Board): void` — debounce（預設 500ms）；唯讀模式下略過並記錄
    - `flush(): Promise<void>` — 立即寫出待寫入的內容，app 結束前呼叫

`debounceMs` 開放注入純粹是為了測試——真等 500ms 會讓測試變慢，而用 fake timer 又跟真實的檔案 I/O 打架（fake timer 不會等 I/O 完成）。測試傳 10ms 搭配真 timer 最穩。

**兩個設計要點：**

**原子寫入。** 先寫 `board.json.tmp` 再 `rename` 覆蓋。`rename` 在同一檔案系統上是原子操作，因此不會出現「寫到一半斷電導致 JSON 半截」的情況——而那正是損毀容錯要處理的主因。

**損毀時修復優先於重置。** 解析失敗或結構不符才備份成 `board.json.corrupt-<timestamp>` 並回退預設看板；若只是引用不一致（`cardIds` 指向已刪除的卡片、卡片不屬於任何欄位），用 `reconcile` 修好即可，不該讓使用者整個看板消失。

- [ ] **Step 1: 撰寫失敗的測試**

`tests/main/board-store.test.ts`：

```ts
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
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -- board-store`
Expected: FAIL — 無法解析 `../../src/main/board-store`

- [ ] **Step 3: 實作 board-store.ts**

`src/main/board-store.ts`：

```ts
import { randomUUID } from 'node:crypto'
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
  const columns = board.columns.map((c) => ({
    ...c,
    cardIds: c.cardIds.filter((id) => {
      if (board.cards[id]) return true
      console.warn('[board-store] 移除指向不存在卡片的引用', { columnId: c.id, cardId: id })
      return false
    }),
  }))

  const placed = new Set(columns.flatMap((c) => c.cardIds))
  const orphans = Object.keys(board.cards).filter((id) => !placed.has(id))

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

  constructor(
    private readonly filePath: string,
    private readonly genId: () => string = randomUUID,
    private readonly debounceMs: number = SAVE_DEBOUNCE_MS,
  ) {}

  async load(): Promise<BoardLoadResult> {
    let raw: string
    try {
      raw = await fs.readFile(this.filePath, 'utf8')
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        // 首次啟動：建立預設看板並立即落地，之後的 save 才有檔案可覆蓋
        const board = createDefaultBoard(this.genId)
        await this.writeAtomic(board)
        return { board, recoveredFrom: null }
      }
      // 檔案存在但讀不到（權限、fd 耗盡等）：絕不能覆寫它。
      // 以預設看板讓 app 能啟動，同時進入唯讀模式擋掉後續寫入。
      console.error('[board-store] 讀取 board.json 失敗，改以預設看板啟動並停用寫入', {
        filePath: this.filePath,
        code,
        err,
      })
      this.readOnly = true
      return { board: createDefaultBoard(this.genId), recoveredFrom: null }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      console.warn('[board-store] board.json 解析失敗，備份後回退預設看板', { err })
      return { board: await this.resetToDefault(), recoveredFrom: await this.backup(raw) }
    }

    if (!isValidBoard(parsed)) {
      console.warn('[board-store] board.json 結構不符，備份後回退預設看板')
      return { board: await this.resetToDefault(), recoveredFrom: await this.backup(raw) }
    }

    // 結構合法只是引用錯亂，修好就好，不該讓使用者整個看板消失
    return { board: reconcile(parsed), recoveredFrom: null }
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
      // debounce 回呼沒有呼叫端接住，必須自己吞掉例外，
      // 否則會成為未處理的 Promise rejection 而終止 Electron main 程序
      void this.flush().catch((err) => {
        console.error('[board-store] debounce 存檔失敗', { filePath: this.filePath, err })
      })
    }, this.debounceMs)
  }

  /** 立即寫出待寫入內容，app 結束前呼叫以免最後一次變更遺失 */
  async flush(): Promise<void> {
    if (this.readOnly) return
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const board = this.pending
    if (!board) return
    this.pending = null
    await this.writeAtomic(board)
  }

  /** 先寫 .tmp 再 rename——rename 是原子操作，避免寫到一半中斷造成半截 JSON */
  private async writeAtomic(board: Board): Promise<void> {
    const tmp = `${this.filePath}.tmp`
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      await fs.writeFile(tmp, JSON.stringify(board, null, 2), 'utf8')
      await fs.rename(tmp, this.filePath)
    } catch (err) {
      console.error('[board-store] 寫入 board.json 失敗', { filePath: this.filePath, err })
      // 清理暫存檔本身也可能失敗（force 只吞 ENOENT，不吞 EACCES/EPERM），
      // 絕不可讓它把例外往外拋，否則會沿著 flush 冒泡成未處理的 rejection
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
    const board = createDefaultBoard(this.genId)
    await this.writeAtomic(board)
    return board
  }
}
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -- board-store`
Expected: PASS — 23 個測試全綠

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: board.json 持久化

原子寫入（.tmp + rename）、save debounce 500ms、flush 供 app 結束時使用。
損毀時備份為 board.json.corrupt-<timestamp> 並回退預設看板；
引用不一致改用 reconcile 修復，不重置整個看板。"
```

---

### Task 5: pty-manager

**Files:**
- Create: `src/main/pty-manager.ts`
- Test: `tests/main/pty-manager.test.ts`

**Interfaces:**
- Consumes: 無
- Produces:
  - `interface SpawnOptions { file: string; args: string[]; cwd: string; cols: number; rows: number; env: NodeJS.ProcessEnv }`
  - `type PtySpawner = (opts: SpawnOptions) => IPty`
  - `class PtyManager`
    - `constructor(spawner: PtySpawner)`
    - `spawn(cardId: string, cwd: string, command: string, cols: number, rows: number): void`
    - `write(cardId: string, data: string): void`
    - `resize(cardId: string, cols: number, rows: number): void`
    - `kill(cardId: string): void`
    - `killAll(timeoutMs?: number): Promise<void>`
    - `has(cardId: string): boolean`
    - `onData(cb: (cardId: string, data: string) => void): void`
    - `onExit(cb: (cardId: string, exitCode: number) => void): void`

**為何 spawn 的是互動 shell 而非直接執行 command：** 開的是 `$SHELL -l`，spawn 後才把卡片的 `command` 連同換行寫進去。這樣 (1) login shell 會載入完整 PATH，`claude` 裝在 `~/.local/bin`、nvm 或 homebrew 都找得到；(2) Claude 結束後會回到 shell prompt 而非整個 pty 消失，使用者可以繼續操作，符合 spec「pty 自行結束（使用者輸入 `exit`）才轉 stopped」的定義。

`spawner` 由 constructor 注入，測試才能塞 fake pty 而不真的開子程序。

- [ ] **Step 1: 撰寫失敗的測試**

`tests/main/pty-manager.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SpawnOptions } from '../../src/main/pty-manager'
import { PtyManager } from '../../src/main/pty-manager'

class FakePty {
  written: string[] = []
  killed: string[] = []
  cols = 0
  rows = 0
  private dataCb: ((data: string) => void) | null = null
  private exitCb: ((e: { exitCode: number; signal?: number }) => void) | null = null

  constructor(public readonly opts: SpawnOptions) {
    this.cols = opts.cols
    this.rows = opts.rows
  }

  onData(cb: (data: string) => void) {
    this.dataCb = cb
    return { dispose: () => {} }
  }

  onExit(cb: (e: { exitCode: number; signal?: number }) => void) {
    this.exitCb = cb
    return { dispose: () => {} }
  }

  write(data: string) {
    this.written.push(data)
  }

  resize(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
  }

  kill(signal?: string) {
    this.killed.push(signal ?? 'SIGHUP')
  }

  emitData(data: string) {
    this.dataCb?.(data)
  }

  emitExit(exitCode: number) {
    this.exitCb?.({ exitCode })
  }
}

function setup() {
  const created: FakePty[] = []
  const spawner = vi.fn((opts: SpawnOptions) => {
    const pty = new FakePty(opts)
    created.push(pty)
    return pty as never
  })
  return { created, manager: new PtyManager(spawner), spawner }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('spawn', () => {
  it('以卡片的 cwd 開 login shell，並把 command 寫進去', () => {
    const { created, manager } = setup()
    manager.spawn('card_a', '/tmp/u19', 'claude', 120, 40)

    expect(created).toHaveLength(1)
    expect(created[0].opts.cwd).toBe('/tmp/u19')
    expect(created[0].opts.args).toEqual(['-l'])
    expect(created[0].opts.cols).toBe(120)
    expect(created[0].opts.rows).toBe(40)
    expect(created[0].written).toEqual(['claude\n'])
  })

  it('設定 TERM 為 xterm-256color', () => {
    const { created, manager } = setup()
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)
    expect(created[0].opts.env.TERM).toBe('xterm-256color')
  })

  it('command 為空字串時不寫入任何東西，只留一個乾淨的 shell', () => {
    const { created, manager } = setup()
    manager.spawn('card_a', '/tmp', '   ', 80, 24)
    expect(created[0].written).toEqual([])
  })

  it('對已存在的 cardId 再次 spawn 會先殺掉舊的（重啟語意）', () => {
    const { created, manager } = setup()
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)

    expect(created).toHaveLength(2)
    expect(created[0].killed).toContain('SIGKILL')
    expect(manager.has('card_a')).toBe(true)
  })
})

describe('write / resize', () => {
  it('write 轉發到對應的 pty', () => {
    const { created, manager } = setup()
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)
    manager.write('card_a', 'ls\n')
    expect(created[0].written).toEqual(['claude\n', 'ls\n'])
  })

  it('resize 轉發到對應的 pty', () => {
    const { created, manager } = setup()
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)
    manager.resize('card_a', 200, 50)
    expect(created[0].cols).toBe(200)
    expect(created[0].rows).toBe(50)
  })

  it('對不存在的 cardId 操作時記錄警告而非拋錯', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { manager } = setup()
    expect(() => manager.write('card_nope', 'x')).not.toThrow()
    expect(() => manager.resize('card_nope', 80, 24)).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})

describe('事件廣播', () => {
  it('output 帶著 cardId 發出', () => {
    const { created, manager } = setup()
    const onData = vi.fn()
    manager.onData(onData)
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)

    created[0].emitData('hello')
    expect(onData).toHaveBeenCalledWith('card_a', 'hello')
  })

  it('exit 帶著 cardId 與 exitCode 發出，並自 Map 移除', () => {
    const { created, manager } = setup()
    const onExit = vi.fn()
    manager.onExit(onExit)
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)

    created[0].emitExit(0)
    expect(onExit).toHaveBeenCalledWith('card_a', 0)
    expect(manager.has('card_a')).toBe(false)
  })
})

describe('kill', () => {
  it('kill 送 SIGKILL 並自 Map 移除', () => {
    const { created, manager } = setup()
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)
    manager.kill('card_a')

    expect(created[0].killed).toContain('SIGKILL')
    expect(manager.has('card_a')).toBe(false)
  })
})

describe('killAll', () => {
  it('先全部送 SIGTERM，逾時後對仍存活者送 SIGKILL', async () => {
    vi.useFakeTimers()
    const { created, manager } = setup()
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)
    manager.spawn('card_b', '/tmp', 'claude', 80, 24)

    const done = manager.killAll(500)

    expect(created[0].killed).toEqual(['SIGTERM'])
    expect(created[1].killed).toEqual(['SIGTERM'])

    await vi.advanceTimersByTimeAsync(500)
    await done

    expect(created[0].killed).toEqual(['SIGTERM', 'SIGKILL'])
    expect(created[1].killed).toEqual(['SIGTERM', 'SIGKILL'])
    expect(manager.has('card_a')).toBe(false)
    expect(manager.has('card_b')).toBe(false)
  })

  it('已自行結束的 pty 不會再被 SIGKILL', async () => {
    vi.useFakeTimers()
    const { created, manager } = setup()
    manager.spawn('card_a', '/tmp', 'claude', 80, 24)

    const done = manager.killAll(500)
    created[0].emitExit(0)

    await vi.advanceTimersByTimeAsync(500)
    await done

    expect(created[0].killed).toEqual(['SIGTERM'])
  })

  it('沒有任何 pty 時立即完成', async () => {
    const { manager } = setup()
    await expect(manager.killAll(500)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -- pty-manager`
Expected: FAIL — 無法解析 `../../src/main/pty-manager`

- [ ] **Step 3: 實作 pty-manager.ts**

`src/main/pty-manager.ts`：

```ts
import type { IPty } from 'node-pty'

export interface SpawnOptions {
  file: string
  args: string[]
  cwd: string
  cols: number
  rows: number
  env: NodeJS.ProcessEnv
}

export type PtySpawner = (opts: SpawnOptions) => IPty

const KILL_TIMEOUT_MS = 500

/** 所有 pty 的唯一擁有者。spawner 由外部注入，測試才能替換成 fake。 */
export class PtyManager {
  private readonly ptys = new Map<string, IPty>()
  private dataCb: ((cardId: string, data: string) => void) | null = null
  private exitCb: ((cardId: string, exitCode: number) => void) | null = null

  constructor(private readonly spawner: PtySpawner) {}

  /**
   * 開一個 login shell 並把卡片的 command 寫進去。
   * 不直接 spawn command 的原因：login shell 才有完整 PATH，
   * 且 Claude 結束後會回到 shell prompt，pty 不會跟著消失。
   */
  spawn(cardId: string, cwd: string, command: string, cols: number, rows: number): void {
    if (this.ptys.has(cardId)) {
      console.warn('[pty-manager] cardId 已有 pty，先關閉舊的再重建', { cardId })
      this.kill(cardId)
    }

    const shell = process.env.SHELL ?? '/bin/zsh'
    const pty = this.spawner({
      file: shell,
      args: ['-l'],
      cwd,
      cols,
      rows,
      env: { ...process.env, TERM: 'xterm-256color' },
    })

    pty.onData((data) => this.dataCb?.(cardId, data))
    pty.onExit(({ exitCode }) => {
      this.ptys.delete(cardId)
      this.exitCb?.(cardId, exitCode)
    })

    this.ptys.set(cardId, pty)

    const trimmed = command.trim()
    if (trimmed) pty.write(`${trimmed}\n`)
  }

  write(cardId: string, data: string): void {
    const pty = this.ptys.get(cardId)
    if (!pty) {
      console.warn('[pty-manager] write 找不到對應的 pty，忽略此次輸入', { cardId })
      return
    }
    pty.write(data)
  }

  resize(cardId: string, cols: number, rows: number): void {
    const pty = this.ptys.get(cardId)
    if (!pty) {
      console.warn('[pty-manager] resize 找不到對應的 pty，忽略此次調整', { cardId })
      return
    }
    try {
      pty.resize(cols, rows)
    } catch (err) {
      console.warn('[pty-manager] resize 失敗', { cardId, cols, rows, err })
    }
  }

  kill(cardId: string): void {
    const pty = this.ptys.get(cardId)
    if (!pty) return
    this.ptys.delete(cardId)
    try {
      pty.kill('SIGKILL')
    } catch (err) {
      console.warn('[pty-manager] kill 失敗', { cardId, err })
    }
  }

  /** app 結束時呼叫：全部 SIGTERM，逾時後對仍存活者 SIGKILL */
  async killAll(timeoutMs: number = KILL_TIMEOUT_MS): Promise<void> {
    const ids = [...this.ptys.keys()]
    if (ids.length === 0) return

    for (const id of ids) {
      try {
        this.ptys.get(id)?.kill('SIGTERM')
      } catch (err) {
        console.warn('[pty-manager] 送出 SIGTERM 失敗', { cardId: id, err })
      }
    }

    await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))

    for (const id of ids) {
      const pty = this.ptys.get(id)
      if (!pty) continue
      this.ptys.delete(id)
      try {
        pty.kill('SIGKILL')
      } catch (err) {
        console.warn('[pty-manager] 送出 SIGKILL 失敗', { cardId: id, err })
      }
    }
  }

  has(cardId: string): boolean {
    return this.ptys.has(cardId)
  }

  onData(cb: (cardId: string, data: string) => void): void {
    this.dataCb = cb
  }

  onExit(cb: (cardId: string, exitCode: number) => void): void {
    this.exitCb = cb
  }
}
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test`
Expected: PASS — 累計 5 個測試檔全綠（factory、board-reducer、git、board-store、pty-manager）

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: pty-manager

spawn login shell 後寫入卡片 command，確保 PATH 完整
且 Claude 結束後仍留在 shell。spawner 注入以利測試。
killAll 採 SIGTERM → 500ms → SIGKILL。"
```

---

### Task 6: IPC + preload + main window 整合

把 Task 3–5 的模組接到 Electron 上，讓 renderer 可以透過 `window.gc` 呼叫全部功能。

**Files:**
- Create: `src/main/ipc.ts`
- Create: `src/renderer/global.d.ts`
- Modify: `src/main/index.ts`（整份重寫，Task 1 只是骨架）
- Modify: `src/preload/index.ts`（整份重寫）
- Modify: `src/renderer/App.tsx`（暫時用來驗證 IPC 通暢，Task 7 再換掉）

**Interfaces:**
- Consumes: `BoardStore`（Task 4）、`PtyManager`（Task 5）、`readBranch`（Task 3）、`GcApi`（Task 1）
- Produces:
  - `registerIpc(store: BoardStore, ptyManager: PtyManager, getWindow: () => BrowserWindow | null): void`
  - `window.gc: GcApi`（renderer 全域，含 `homeDir()`）

**IPC channel 一覽**

| channel | 方向 | 型別 |
|---|---|---|
| `board:load` | invoke | `() => BoardLoadResult` |
| `board:save` | invoke | `(board: Board) => void` |
| `pty:spawn` | invoke | `(cardId, cwd, command, cols, rows) => void` |
| `pty:write` | send | `(cardId, data)` |
| `pty:resize` | send | `(cardId, cols, rows)` |
| `pty:kill` | send | `(cardId)` |
| `pty:data` | main → renderer | `(cardId, data)` |
| `pty:exit` | main → renderer | `(cardId, exitCode)` |
| `git:branch` | invoke | `(cwd) => string \| null` |
| `dialog:pickDirectory` | invoke | `() => string \| null` |

高頻的 `pty:write` / `pty:resize` 用 `send` 而非 `invoke`——每個按鍵都會觸發 write，不需要回傳值，`invoke` 的 Promise 開銷是浪費。

- [ ] **Step 1: 撰寫 ipc.ts**

`src/main/ipc.ts`：

```ts
import { type BrowserWindow, dialog, ipcMain } from 'electron'
import type { Board } from '@shared/types'
import type { BoardStore } from './board-store'
import type { PtyManager } from './pty-manager'
import { readBranch } from './git'

export function registerIpc(
  store: BoardStore,
  ptyManager: PtyManager,
  getWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle('board:load', () => store.load())
  ipcMain.handle('board:save', (_event, board: Board) => {
    store.save(board)
  })

  ipcMain.handle(
    'pty:spawn',
    (_event, cardId: string, cwd: string, command: string, cols: number, rows: number) => {
      ptyManager.spawn(cardId, cwd, command, cols, rows)
    },
  )
  ipcMain.on('pty:write', (_event, cardId: string, data: string) => {
    ptyManager.write(cardId, data)
  })
  ipcMain.on('pty:resize', (_event, cardId: string, cols: number, rows: number) => {
    ptyManager.resize(cardId, cols, rows)
  })
  ipcMain.on('pty:kill', (_event, cardId: string) => {
    ptyManager.kill(cardId)
  })

  ipcMain.handle('git:branch', (_event, cwd: string) => readBranch(cwd))

  ipcMain.handle('dialog:pickDirectory', async () => {
    const win = getWindow()
    const options = { properties: ['openDirectory' as const, 'createDirectory' as const] }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // pty 的輸出與結束事件推給 renderer
  ptyManager.onData((cardId, data) => {
    getWindow()?.webContents.send('pty:data', cardId, data)
  })
  ptyManager.onExit((cardId, exitCode) => {
    getWindow()?.webContents.send('pty:exit', cardId, exitCode)
  })
}
```

- [ ] **Step 2: 重寫 main/index.ts**

`src/main/index.ts`：

```ts
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
```

- [ ] **Step 3: 重寫 preload/index.ts**

`src/preload/index.ts`：

```ts
import { homedir } from 'node:os'
import { contextBridge, ipcRenderer } from 'electron'
import type { Board, BoardLoadResult, GcApi } from '@shared/types'

const api: GcApi = {
  board: {
    load: () => ipcRenderer.invoke('board:load') as Promise<BoardLoadResult>,
    save: (board) => ipcRenderer.invoke('board:save', board) as Promise<void>,
  },
  pty: {
    spawn: (cardId, cwd, command, cols, rows) =>
      ipcRenderer.invoke('pty:spawn', cardId, cwd, command, cols, rows) as Promise<void>,
    write: (cardId, data) => ipcRenderer.send('pty:write', cardId, data),
    resize: (cardId, cols, rows) => ipcRenderer.send('pty:resize', cardId, cols, rows),
    kill: (cardId) => ipcRenderer.send('pty:kill', cardId),
  },
  onPtyData: (cb) => {
    const listener = (_event: unknown, cardId: string, data: string): void => cb(cardId, data)
    ipcRenderer.on('pty:data', listener)
    return () => {
      ipcRenderer.off('pty:data', listener)
    }
  },
  onPtyExit: (cb) => {
    const listener = (_event: unknown, cardId: string, exitCode: number): void =>
      cb(cardId, exitCode)
    ipcRenderer.on('pty:exit', listener)
    return () => {
      ipcRenderer.off('pty:exit', listener)
    }
  },
  git: {
    branch: (cwd) => ipcRenderer.invoke('git:branch', cwd) as Promise<string | null>,
  },
  dialog: {
    pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory') as Promise<string | null>,
  },
  // renderer 在 contextIsolation 下沒有 process 物件，家目錄只能由 preload 帶過去
  homeDir: () => homedir(),
}

contextBridge.exposeInMainWorld('gc', api)
```

- [ ] **Step 4: 宣告 window.gc 的型別**

`src/renderer/global.d.ts`：

```ts
import type { GcApi } from '@shared/types'

declare global {
  interface Window {
    gc: GcApi
  }
}

export {}
```

- [ ] **Step 5: 暫時改寫 App.tsx 以驗證 IPC**

此版本只用來確認整條鏈路通暢，Task 7 會整個換掉。

`src/renderer/App.tsx`：

```tsx
import { useEffect, useState } from 'react'
import type { Board } from '@shared/types'

export default function App(): JSX.Element {
  const [board, setBoard] = useState<Board | null>(null)
  const [branch, setBranch] = useState<string | null>(null)

  useEffect(() => {
    void window.gc.board.load().then((result) => setBoard(result.board))
    void window.gc.git.branch(window.gc.homeDir()).then(setBranch)
  }, [])

  return (
    <div className="h-full overflow-auto p-6 font-mono text-xs text-fg">
      <p className="mb-2 text-fg-dim">IPC 驗證用畫面（Task 7 將取代）</p>
      <p className="mb-4">home 目錄的 branch：{branch ?? '（非 git repo）'}</p>
      <pre>{board ? JSON.stringify(board, null, 2) : '載入中…'}</pre>
    </div>
  )
}
```

- [ ] **Step 6: 手動驗證整條鏈路**

Run: `npm run dev`

依序確認：

1. 視窗顯示的 JSON 含四個預設欄位（`需求評估中` / `開發中` / `Review 中` / `等待 Merge`）
2. `cat ~/.sharkcommand/board.json` — 檔案已建立且內容一致
3. 開啟 DevTools（⌥⌘I），在 Console 執行以下指令，確認終端機互動可用：

```js
window.gc.onPtyData((id, d) => console.log('[data]', id, JSON.stringify(d)))
await window.gc.pty.spawn('probe', window.gc.homeDir(), 'echo 你好 SharkCommand', 80, 24)
```

Expected: Console 陸續印出 shell 啟動訊息與 `你好 SharkCommand`

4. 清理探針：`window.gc.pty.kill('probe')`
5. ⌘Q 結束，確認 terminal 沒有殘留的 shell 程序：`pgrep -fl "zsh -l" | grep -v grep`

Run: `npm run typecheck`
Expected: 無錯誤

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: IPC 串接 main 與 renderer

board / pty / git / dialog 四組 channel，
高頻的 pty write 與 resize 用 send 而非 invoke。
before-quit 先 flush 看板再 killAll。"
```

---

### Task 7: 看板 UI（不含拖拉）

**Files:**
- Create: `src/renderer/store/app-store.ts`
- Create: `src/renderer/board/BoardPane.tsx`
- Create: `src/renderer/board/Column.tsx`
- Create: `src/renderer/board/ColumnHeader.tsx`
- Create: `src/renderer/board/CardItem.tsx`
- Create: `src/renderer/board/CardDialog.tsx`
- Create: `src/renderer/RecoveryNotice.tsx`
- Modify: `src/renderer/App.tsx`（換掉 Task 6 的驗證畫面）

**Interfaces:**
- Consumes: Task 2 的 reducer 全部函式、Task 1 的 factory、Task 6 的 `window.gc`
- Produces:
  - `useAppStore` — zustand store，欄位：`board`、`activeCardId`、`loaded`、`recoveryNotice`
  - `<RecoveryNotice />` — 看板檔損毀時的可關閉橫幅
  - action：`loadBoard()`、`setActiveCard(cardId)`、`dismissRecoveryNotice()`、`addCard(columnId, input)`、`updateCard(cardId, patch)`、`deleteCard(cardId)`、`moveCard(cardId, toColumnId, toIndex)`、`addColumn(title)`、`updateColumn(columnId, patch)`、`deleteColumn(columnId)`、`moveColumn(columnId, toIndex)`
  - `<CardItem card={card} active={boolean} onClick={() => void} onEdit={() => void} />`
  - `<Column column={column} />`
  - `<BoardPane />`

**store 的唯一寫入路徑：** 所有 action 都經由內部的 `persist()` — 先 `set({ board })` 再 `window.gc.board.save(board)`。任何繞過 `persist` 直接 `set` 的變更都不會存檔，Task 8 新增拖拉 action 時務必照此模式。

- [ ] **Step 1: 撰寫 app-store**

`src/renderer/store/app-store.ts`：

```ts
import { create } from 'zustand'
import type { Board } from '@shared/types'
import { newCard, newColumn, pickColumnColor } from '@shared/factory'
import {
  type CardPatch,
  type ColumnPatch,
  addCard,
  addColumn,
  deleteCard,
  deleteColumn,
  moveCard,
  moveColumn,
  updateCard,
  updateColumn,
} from './board-reducer'

export interface CardInput {
  title: string
  cwd: string
  command: string
  note?: string
}

interface AppState {
  board: Board
  activeCardId: string | null
  loaded: boolean
  /** 非 null 代表看板檔曾損毀，值為備份檔路徑，供橫幅提示使用 */
  recoveryNotice: string | null

  loadBoard: () => Promise<void>
  setActiveCard: (cardId: string | null) => void
  dismissRecoveryNotice: () => void

  addCard: (columnId: string, input: CardInput) => void
  updateCard: (cardId: string, patch: CardPatch) => void
  deleteCard: (cardId: string) => void
  moveCard: (cardId: string, toColumnId: string, toIndex: number) => void

  addColumn: (title: string) => void
  updateColumn: (columnId: string, patch: ColumnPatch) => void
  deleteColumn: (columnId: string) => void
  moveColumn: (columnId: string, toIndex: number) => void
}

const EMPTY_BOARD: Board = { version: 1, columns: [], cards: {} }

export const useAppStore = create<AppState>((set, get) => {
  /** 唯一的寫入路徑：更新 state 後立即請 main 存檔（main 端會 debounce） */
  const persist = (board: Board): void => {
    set({ board })
    void window.gc.board.save(board)
  }

  return {
    board: EMPTY_BOARD,
    activeCardId: null,
    loaded: false,
    recoveryNotice: null,

    loadBoard: async () => {
      try {
        const { board, recoveredFrom } = await window.gc.board.load()
        set({ board, loaded: true, recoveryNotice: recoveredFrom })
      } catch (err) {
        console.error('[app-store] 載入看板失敗，改用空白看板', { err })
        set({ board: EMPTY_BOARD, loaded: true })
      }
    },

    setActiveCard: (cardId) => set({ activeCardId: cardId }),

    dismissRecoveryNotice: () => set({ recoveryNotice: null }),

    addCard: (columnId, input) => {
      const card = newCard(input, crypto.randomUUID(), new Date().toISOString())
      persist(addCard(get().board, columnId, card))
    },

    updateCard: (cardId, patch) => {
      persist(updateCard(get().board, cardId, patch, new Date().toISOString()))
    },

    deleteCard: (cardId) => {
      window.gc.pty.kill(cardId)
      const { activeCardId } = get()
      if (activeCardId === cardId) set({ activeCardId: null })
      persist(deleteCard(get().board, cardId))
    },

    moveCard: (cardId, toColumnId, toIndex) => {
      persist(moveCard(get().board, cardId, toColumnId, toIndex))
    },

    addColumn: (title) => {
      const { board } = get()
      const column = newColumn(title, pickColumnColor(board.columns), crypto.randomUUID())
      persist(addColumn(board, column))
    },

    updateColumn: (columnId, patch) => {
      persist(updateColumn(get().board, columnId, patch))
    },

    deleteColumn: (columnId) => {
      const { board, activeCardId } = get()
      const result = deleteColumn(board, columnId)
      // 欄位連同卡片一起消失，對應的 pty 也要收掉
      for (const cardId of result.removedCardIds) window.gc.pty.kill(cardId)
      if (activeCardId && result.removedCardIds.includes(activeCardId)) set({ activeCardId: null })
      persist(result.board)
    },

    moveColumn: (columnId, toIndex) => {
      persist(moveColumn(get().board, columnId, toIndex))
    },
  }
})
```

- [ ] **Step 2: 撰寫 CardItem**

`src/renderer/board/CardItem.tsx`：

```tsx
import type { Card } from '@shared/types'

/** 把家目錄縮寫成 ~，路徑過長時只留最後兩層 */
export function shortenPath(cwd: string, home: string): string {
  const path = cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd
  const parts = path.split('/')
  return parts.length <= 3 ? path : `…/${parts.slice(-2).join('/')}`
}

interface Props {
  card: Card
  active: boolean
  home: string
  onSelect: () => void
  onEdit: () => void
}

export default function CardItem({ card, active, home, onSelect, onEdit }: Props): JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onEdit()
      }}
      className={`group cursor-pointer rounded-lg border bg-card px-3 py-2 transition-all hover:-translate-y-0.5 hover:border-line-hover ${
        active ? 'border-line-hover ring-1 ring-line-hover' : 'border-line'
      }`}
    >
      <div className="truncate text-[13px] leading-5 text-fg">{card.title}</div>
      <div className="mt-0.5 truncate font-mono text-[11px] leading-4 text-fg-dim">
        {shortenPath(card.cwd, home)}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 撰寫 ColumnHeader**

`src/renderer/board/ColumnHeader.tsx`：

```tsx
import { useState } from 'react'
import type { Column } from '@shared/types'
import { useAppStore } from '../store/app-store'

interface Props {
  column: Column
  onAddCard: () => void
}

export default function ColumnHeader({ column, onAddCard }: Props): JSX.Element {
  const updateColumn = useAppStore((s) => s.updateColumn)
  const deleteColumn = useAppStore((s) => s.deleteColumn)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(column.title)

  const commit = (): void => {
    const title = draft.trim()
    if (title && title !== column.title) updateColumn(column.id, { title })
    else setDraft(column.title)
    setEditing(false)
  }

  return (
    <div className="shrink-0">
      <div className="h-[3px] rounded-full" style={{ backgroundColor: column.color }} />
      <div className="flex items-center gap-2 px-1 py-2">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setDraft(column.title)
                setEditing(false)
              }
            }}
            className="min-w-0 flex-1 rounded border border-line bg-card px-1 text-[13px] text-fg outline-none"
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => setEditing(true)}
            className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-fg"
            title="雙擊可改名"
          >
            {column.title}
          </button>
        )}
        <span className="shrink-0 text-[11px] text-fg-dim">{column.cardIds.length}</span>
        <button
          type="button"
          onClick={onAddCard}
          title="新增卡片"
          className="shrink-0 px-1 text-fg-dim transition-colors hover:text-fg"
        >
          ＋
        </button>
        <button
          type="button"
          onClick={() => {
            const count = column.cardIds.length
            const message =
              count === 0
                ? `確定刪除欄位「${column.title}」？`
                : `確定刪除欄位「${column.title}」？欄內 ${count} 張卡片與其終端機都會一併關閉。`
            if (window.confirm(message)) deleteColumn(column.id)
          }}
          title="刪除欄位"
          className="shrink-0 px-1 text-fg-dim opacity-0 transition-opacity hover:text-fg group-hover/column:opacity-100"
        >
          ×
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 撰寫 CardDialog**

`src/renderer/board/CardDialog.tsx`：

```tsx
import { useEffect, useState } from 'react'
import type { Card } from '@shared/types'

export interface CardDraft {
  title: string
  cwd: string
  command: string
  note: string
}

interface Props {
  /** 有值代表編輯既有卡片，null 代表新增 */
  card: Card | null
  onCancel: () => void
  onSubmit: (draft: CardDraft) => void
  onDelete?: () => void
}

export default function CardDialog({ card, onCancel, onSubmit, onDelete }: Props): JSX.Element {
  const [draft, setDraft] = useState<CardDraft>({
    title: card?.title ?? '',
    cwd: card?.cwd ?? '',
    command: card?.command ?? 'claude',
    note: card?.note ?? '',
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const pickDirectory = async (): Promise<void> => {
    try {
      const picked = await window.gc.dialog.pickDirectory()
      if (picked) setDraft((d) => ({ ...d, cwd: picked }))
    } catch (err) {
      console.warn('[CardDialog] 選擇目錄失敗', { err })
    }
  }

  const canSubmit = draft.title.trim() !== '' && draft.cwd.trim() !== ''

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onCancel}
    >
      <div
        className="w-[440px] rounded-lg border border-line bg-column p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-[15px] text-fg">{card ? '編輯卡片' : '新增卡片'}</h2>

        <label className="mb-1 block text-[11px] text-fg-dim">標題</label>
        <input
          autoFocus
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="例如：U19 登入流程重構"
          className="mb-3 w-full rounded border border-line bg-card px-2 py-1.5 text-[13px] text-fg outline-none focus:border-line-hover"
        />

        <label className="mb-1 block text-[11px] text-fg-dim">工作目錄</label>
        <div className="mb-3 flex gap-2">
          <input
            value={draft.cwd}
            onChange={(e) => setDraft({ ...draft, cwd: e.target.value })}
            placeholder="/Users/…"
            className="min-w-0 flex-1 rounded border border-line bg-card px-2 py-1.5 font-mono text-[12px] text-fg outline-none focus:border-line-hover"
          />
          <button
            type="button"
            onClick={() => void pickDirectory()}
            className="shrink-0 rounded border border-line px-3 text-[12px] text-fg-dim transition-colors hover:text-fg"
          >
            選擇…
          </button>
        </div>

        <label className="mb-1 block text-[11px] text-fg-dim">啟動指令</label>
        <input
          value={draft.command}
          onChange={(e) => setDraft({ ...draft, command: e.target.value })}
          placeholder="claude"
          className="mb-3 w-full rounded border border-line bg-card px-2 py-1.5 font-mono text-[12px] text-fg outline-none focus:border-line-hover"
        />

        <label className="mb-1 block text-[11px] text-fg-dim">備註</label>
        <textarea
          value={draft.note}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          rows={3}
          className="mb-4 w-full resize-none rounded border border-line bg-card px-2 py-1.5 text-[12px] text-fg outline-none focus:border-line-hover"
        />

        <div className="flex items-center gap-2">
          {onDelete && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('確定刪除這張卡片？終端機也會一併關閉。')) onDelete()
              }}
              className="mr-auto rounded px-2 py-1.5 text-[12px] text-fg-dim transition-colors hover:text-fg"
            >
              刪除
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto rounded border border-line px-3 py-1.5 text-[12px] text-fg-dim transition-colors hover:text-fg"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onSubmit(draft)}
            className="rounded bg-card px-3 py-1.5 text-[12px] text-fg transition-opacity disabled:opacity-40"
          >
            儲存
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: 撰寫 Column 與 BoardPane**

`src/renderer/board/Column.tsx`：

```tsx
import type { Column as ColumnType } from '@shared/types'
import { useAppStore } from '../store/app-store'
import CardItem from './CardItem'
import ColumnHeader from './ColumnHeader'

interface Props {
  column: ColumnType
  home: string
  onAddCard: (columnId: string) => void
  onEditCard: (cardId: string) => void
}

export default function Column({ column, home, onAddCard, onEditCard }: Props): JSX.Element {
  const cards = useAppStore((s) => s.board.cards)
  const activeCardId = useAppStore((s) => s.activeCardId)
  const setActiveCard = useAppStore((s) => s.setActiveCard)

  return (
    <div className="group/column flex w-[260px] shrink-0 flex-col rounded-lg bg-column p-2">
      <ColumnHeader column={column} onAddCard={() => onAddCard(column.id)} />
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {column.cardIds.map((cardId) => {
          const card = cards[cardId]
          if (!card) return null
          return (
            <CardItem
              key={cardId}
              card={card}
              home={home}
              active={activeCardId === cardId}
              onSelect={() => setActiveCard(cardId)}
              onEdit={() => onEditCard(cardId)}
            />
          )
        })}
      </div>
    </div>
  )
}
```

`src/renderer/board/BoardPane.tsx`：

```tsx
import { useState } from 'react'
import { useAppStore } from '../store/app-store'
import CardDialog, { type CardDraft } from './CardDialog'
import Column from './Column'

/** null 代表對話框關閉；有值時 columnId 為新增目標、cardId 為編輯目標 */
type DialogState = { mode: 'create'; columnId: string } | { mode: 'edit'; cardId: string } | null

interface Props {
  home: string
}

export default function BoardPane({ home }: Props): JSX.Element {
  const columns = useAppStore((s) => s.board.columns)
  const cards = useAppStore((s) => s.board.cards)
  const addCard = useAppStore((s) => s.addCard)
  const updateCard = useAppStore((s) => s.updateCard)
  const deleteCard = useAppStore((s) => s.deleteCard)
  const addColumn = useAppStore((s) => s.addColumn)
  const [dialog, setDialog] = useState<DialogState>(null)

  const submit = (draft: CardDraft): void => {
    if (!dialog) return
    if (dialog.mode === 'create') {
      addCard(dialog.columnId, {
        title: draft.title.trim(),
        cwd: draft.cwd.trim(),
        command: draft.command.trim(),
        note: draft.note,
      })
    } else {
      updateCard(dialog.cardId, {
        title: draft.title.trim(),
        cwd: draft.cwd.trim(),
        command: draft.command.trim(),
        note: draft.note,
      })
    }
    setDialog(null)
  }

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-3">
      {columns.map((column) => (
        <Column
          key={column.id}
          column={column}
          home={home}
          onAddCard={(columnId) => setDialog({ mode: 'create', columnId })}
          onEditCard={(cardId) => setDialog({ mode: 'edit', cardId })}
        />
      ))}

      <button
        type="button"
        onClick={() => {
          const title = window.prompt('新欄位名稱')?.trim()
          if (title) addColumn(title)
        }}
        className="h-9 w-[160px] shrink-0 rounded-lg border border-dashed border-line text-[12px] text-fg-dim transition-colors hover:border-line-hover hover:text-fg"
      >
        ＋ 新增欄位
      </button>

      {dialog && (
        <CardDialog
          card={dialog.mode === 'edit' ? (cards[dialog.cardId] ?? null) : null}
          onCancel={() => setDialog(null)}
          onSubmit={submit}
          onDelete={
            dialog.mode === 'edit'
              ? () => {
                  deleteCard(dialog.cardId)
                  setDialog(null)
                }
              : undefined
          }
        />
      )}
    </div>
  )
}
```

- [ ] **Step 6: 撰寫損毀提示橫幅**

`src/renderer/RecoveryNotice.tsx`：

```tsx
import { useAppStore } from './store/app-store'

/** 看板檔損毀並被回退時顯示，讓使用者知道原始資料還在哪裡 */
export default function RecoveryNotice(): JSX.Element | null {
  const notice = useAppStore((s) => s.recoveryNotice)
  const dismiss = useAppStore((s) => s.dismissRecoveryNotice)

  if (!notice) return null

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-line bg-column px-3 py-2 text-[12px]">
      <span className="min-w-0 flex-1 text-fg">
        看板檔案損毀，已回退為預設看板。原始內容備份於{' '}
        <span className="font-mono text-fg-dim">{notice}</span>
      </span>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded border border-line px-2 py-0.5 text-fg-dim transition-colors hover:text-fg"
      >
        知道了
      </button>
    </div>
  )
}
```

- [ ] **Step 7: 改寫 App.tsx**

`src/renderer/App.tsx`：

```tsx
import { useEffect, useState } from 'react'
import BoardPane from './board/BoardPane'
import RecoveryNotice from './RecoveryNotice'
import { useAppStore } from './store/app-store'

export default function App(): JSX.Element {
  const loaded = useAppStore((s) => s.loaded)
  const loadBoard = useAppStore((s) => s.loadBoard)
  const [home, setHome] = useState('')

  useEffect(() => {
    void loadBoard()
    setHome(window.gc.homeDir())
  }, [loadBoard])

  if (!loaded) {
    return <div className="flex h-full items-center justify-center text-fg-dim">載入中…</div>
  }

  return (
    <div className="flex h-full flex-col bg-base">
      <RecoveryNotice />
      <div className="min-h-0 flex-1">
        <BoardPane home={home} />
      </div>
    </div>
  )
}
```

- [ ] **Step 8: 手動驗證**

Run: `npm run dev`

依序確認：

1. 看到四個欄位，各有 3px 色帶且顏色不同
2. 點欄位的「＋」→ 填標題、按「選擇…」挑目錄、按儲存 → 卡片出現在該欄
3. `cat ~/.sharkcommand/board.json` — 卡片已寫入
4. 雙擊卡片 → 開啟編輯對話框，改標題後儲存 → 卡片標題更新
5. 編輯對話框按「刪除」→ 確認後卡片消失
6. 雙擊欄位標題 → 可改名，Enter 生效、Esc 取消
7. 按「＋ 新增欄位」→ 新欄位出現在最右且顏色與前一欄不同
8. 刪除有卡片的欄位 → 確認訊息提到卡片數量，確認後欄位與卡片一起消失
9. ⌘Q 後重開 `npm run dev` → 所有變更都還在
10. 損毀容錯：`echo 'x' > ~/.sharkcommand/board.json` 後重開 app → 頂端出現橫幅並指出備份檔路徑，按「知道了」可關閉

Run: `npm test && npm run typecheck`
Expected: 全綠、無型別錯誤

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: 看板 UI

zustand store 以 persist 為唯一寫入路徑，變更即存檔。
欄位含色帶與雙擊改名，卡片支援新增／編輯／刪除，
刪除卡片或欄位時連帶關閉對應的 pty。"
```

---

### Task 8: 拖拉

**Files:**
- Create: `src/renderer/board/DragCardPreview.tsx`
- Modify: `src/renderer/store/app-store.ts`（新增 `previewBoard` / `commitBoard` / `restoreBoard`）
- Modify: `src/renderer/board/CardItem.tsx`（加上 `useSortable`）
- Modify: `src/renderer/board/Column.tsx`（欄位本身可拖、卡片區可接收）
- Modify: `src/renderer/board/ColumnHeader.tsx`（成為欄位的 drag handle）
- Modify: `src/renderer/board/BoardPane.tsx`（`DndContext` + `DragOverlay`）

**Interfaces:**
- Consumes: Task 7 的 `useAppStore`、Task 2 的 `moveCard` / `moveColumn`
- Produces:
  - store 新增 `previewBoard(board: Board): void`（只更新畫面，不存檔）
  - store 新增 `commitBoard(): void`（把目前 board 存檔）
  - store 新增 `restoreBoard(board: Board): void`（取消拖拉時還原）
  - `<DragCardPreview card={card} home={home} />`

**為什麼要拆出 preview 與 commit：** 跨欄拖拉若沒有即時預覽，目標欄的卡片不會讓位，體感很差。但 `onDragOver` 每幀都會觸發，若直接走 Task 7 的 `persist` 就會每幀丟一次 IPC 存檔。所以拖拉期間走 `previewBoard`（純畫面），放開時才 `commitBoard` 存一次檔。`onDragStart` 先留一份 snapshot，`onDragCancel` 用 `restoreBoard` 還原。

**`toIndex` 的計算：** 直接用 `over` 卡片在目標欄中的索引即可，同欄與跨欄都正確。因為 Task 2 的 `moveCard` 是「先自所有欄位移除，再插入」，同欄往後拖時索引會自然因移除而前移一位。若 `over` 是欄位本身（拖到空欄或欄位空白處），`toIndex` 取該欄卡片數（插到末端）。

- [ ] **Step 1: store 新增三個拖拉專用 action**

在 `src/renderer/store/app-store.ts` 的 `AppState` 介面加入：

```ts
  /** 拖拉期間更新畫面但不存檔 */
  previewBoard: (board: Board) => void
  /** 拖拉結束，把目前 board 存檔 */
  commitBoard: () => void
  /** 取消拖拉，還原成拖拉前的 snapshot */
  restoreBoard: (board: Board) => void
```

在 `return { ... }` 物件中加入實作：

```ts
    previewBoard: (board) => set({ board }),

    commitBoard: () => {
      void window.gc.board.save(get().board)
    },

    restoreBoard: (board) => set({ board }),
```

- [ ] **Step 2: CardItem 加上 useSortable**

`src/renderer/board/CardItem.tsx` — 保留既有的 `shortenPath` 與 Props，改寫元件本體：

```tsx
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Card } from '@shared/types'

/** 把家目錄縮寫成 ~，路徑過長時只留最後兩層 */
export function shortenPath(cwd: string, home: string): string {
  const path = cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd
  const parts = path.split('/')
  return parts.length <= 3 ? path : `…/${parts.slice(-2).join('/')}`
}

interface Props {
  card: Card
  columnId: string
  active: boolean
  home: string
  onSelect: () => void
  onEdit: () => void
}

export default function CardItem({
  card,
  columnId,
  active,
  home,
  onSelect,
  onEdit,
}: Props): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card', columnId },
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onEdit()
      }}
      className={`group cursor-pointer rounded-lg border bg-card px-3 py-2 transition-all hover:-translate-y-0.5 hover:border-line-hover ${
        active ? 'border-line-hover ring-1 ring-line-hover' : 'border-line'
      } ${isDragging ? 'opacity-30' : ''}`}
    >
      <div className="truncate text-[13px] leading-5 text-fg">{card.title}</div>
      <div className="mt-0.5 truncate font-mono text-[11px] leading-4 text-fg-dim">
        {shortenPath(card.cwd, home)}
      </div>
    </div>
  )
}
```

`isDragging` 時降到 30% 不透明度，原位置就成了 placeholder；真正跟著游標的是 `DragOverlay` 裡的 `DragCardPreview`。

- [ ] **Step 3: 拖拉時跟著游標的卡片外觀**

`src/renderer/board/DragCardPreview.tsx`：

```tsx
import type { Card } from '@shared/types'
import { shortenPath } from './CardItem'

interface Props {
  card: Card
  home: string
}

/** DragOverlay 專用：傾斜 3 度並抬起陰影，與原位置的半透明 placeholder 區隔 */
export default function DragCardPreview({ card, home }: Props): JSX.Element {
  return (
    <div className="w-[244px] rotate-3 rounded-lg border border-line-hover bg-card px-3 py-2 shadow-2xl">
      <div className="truncate text-[13px] leading-5 text-fg">{card.title}</div>
      <div className="mt-0.5 truncate font-mono text-[11px] leading-4 text-fg-dim">
        {shortenPath(card.cwd, home)}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Column 支援欄位拖拉與卡片放置**

`src/renderer/board/Column.tsx`：

```tsx
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Column as ColumnType } from '@shared/types'
import { useAppStore } from '../store/app-store'
import CardItem from './CardItem'
import ColumnHeader from './ColumnHeader'

interface Props {
  column: ColumnType
  home: string
  onAddCard: (columnId: string) => void
  onEditCard: (cardId: string) => void
}

export default function Column({ column, home, onAddCard, onEditCard }: Props): JSX.Element {
  const cards = useAppStore((s) => s.board.cards)
  const activeCardId = useAppStore((s) => s.activeCardId)
  const setActiveCard = useAppStore((s) => s.setActiveCard)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.id,
    data: { type: 'column' },
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`group/column flex w-[260px] shrink-0 flex-col rounded-lg bg-column p-2 ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <ColumnHeader
        column={column}
        onAddCard={() => onAddCard(column.id)}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
      <SortableContext items={column.cardIds} strategy={verticalListSortingStrategy}>
        {/* min-h 讓空欄仍有可放置的區域，否則卡片拖不進空欄 */}
        <div className="flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto">
          {column.cardIds.map((cardId) => {
            const card = cards[cardId]
            if (!card) return null
            return (
              <CardItem
                key={cardId}
                card={card}
                columnId={column.id}
                home={home}
                active={activeCardId === cardId}
                onSelect={() => setActiveCard(cardId)}
                onEdit={() => onEditCard(cardId)}
              />
            )
          })}
        </div>
      </SortableContext>
    </div>
  )
}
```

- [ ] **Step 5: ColumnHeader 成為 drag handle**

修改 `src/renderer/board/ColumnHeader.tsx` 的 Props 與標題按鈕。Props 加一個欄位：

```ts
interface Props {
  column: Column
  onAddCard: () => void
  /** 由 Column 的 useSortable 傳入，只掛在標題上——整欄都可拖會與卡片拖拉打架 */
  dragHandleProps: Record<string, unknown>
}
```

函式簽名改成 `({ column, onAddCard, dragHandleProps }: Props)`，並把非編輯狀態的標題按鈕改成：

```tsx
          <button
            type="button"
            {...dragHandleProps}
            onDoubleClick={() => setEditing(true)}
            className="min-w-0 flex-1 cursor-grab truncate text-left text-[13px] font-medium text-fg active:cursor-grabbing"
            title="拖曳可調整欄位順序，雙擊可改名"
          >
            {column.title}
          </button>
```

- [ ] **Step 6: BoardPane 接上 DndContext**

`src/renderer/board/BoardPane.tsx` — 保留 Task 7 的 `DialogState`、`submit` 與對話框部分，其餘改寫：

```tsx
import { useRef, useState } from 'react'
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import type { Board } from '@shared/types'
import { moveCard as moveCardIn, moveColumn as moveColumnIn } from '../store/board-reducer'
import { useAppStore } from '../store/app-store'
import CardDialog, { type CardDraft } from './CardDialog'
import Column from './Column'
import DragCardPreview from './DragCardPreview'

type DialogState = { mode: 'create'; columnId: string } | { mode: 'edit'; cardId: string } | null

interface Props {
  home: string
}

/** 找出卡片目前所在的欄位 id */
function columnIdOfCard(board: Board, cardId: string): string | null {
  return board.columns.find((c) => c.cardIds.includes(cardId))?.id ?? null
}

export default function BoardPane({ home }: Props): JSX.Element {
  const board = useAppStore((s) => s.board)
  const addCard = useAppStore((s) => s.addCard)
  const updateCard = useAppStore((s) => s.updateCard)
  const deleteCard = useAppStore((s) => s.deleteCard)
  const addColumn = useAppStore((s) => s.addColumn)
  const previewBoard = useAppStore((s) => s.previewBoard)
  const commitBoard = useAppStore((s) => s.commitBoard)
  const restoreBoard = useAppStore((s) => s.restoreBoard)

  const [dialog, setDialog] = useState<DialogState>(null)
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null)
  const snapshot = useRef<Board | null>(null)

  // 需要一點位移才觸發拖拉，否則單擊卡片會被誤判成拖曳
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const onDragStart = (event: DragStartEvent): void => {
    snapshot.current = useAppStore.getState().board
    if (event.active.data.current?.type === 'card') {
      setDraggingCardId(String(event.active.id))
    }
  }

  /** 拖拉過程即時預覽（不存檔），讓目標欄的卡片會讓位 */
  const onDragOver = (event: DragOverEvent): void => {
    const { active, over } = event
    if (!over || active.data.current?.type !== 'card') return

    const cardId = String(active.id)
    const overId = String(over.id)
    if (cardId === overId) return

    const current = useAppStore.getState().board
    const overColumn = current.columns.find((c) => c.id === overId)

    if (overColumn) {
      // 拖到欄位本身（空欄或欄位空白處）→ 插到末端
      if (columnIdOfCard(current, cardId) === overColumn.id) return
      previewBoard(moveCardIn(current, cardId, overColumn.id, overColumn.cardIds.length))
      return
    }

    const toColumnId = columnIdOfCard(current, overId)
    if (!toColumnId) return
    const toIndex = current.columns
      .find((c) => c.id === toColumnId)!
      .cardIds.indexOf(overId)
    previewBoard(moveCardIn(current, cardId, toColumnId, toIndex))
  }

  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    setDraggingCardId(null)
    snapshot.current = null

    if (!over) {
      commitBoard()
      return
    }

    if (active.data.current?.type === 'column') {
      const current = useAppStore.getState().board
      const toIndex = current.columns.findIndex((c) => c.id === String(over.id))
      if (toIndex !== -1) previewBoard(moveColumnIn(current, String(active.id), toIndex))
    }

    // 卡片位置在 onDragOver 已經預覽到位，這裡只負責落檔
    commitBoard()
  }

  const onDragCancel = (): void => {
    setDraggingCardId(null)
    if (snapshot.current) restoreBoard(snapshot.current)
    snapshot.current = null
  }

  const submit = (draft: CardDraft): void => {
    if (!dialog) return
    const payload = {
      title: draft.title.trim(),
      cwd: draft.cwd.trim(),
      command: draft.command.trim(),
      note: draft.note,
    }
    if (dialog.mode === 'create') addCard(dialog.columnId, payload)
    else updateCard(dialog.cardId, payload)
    setDialog(null)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="flex h-full gap-3 overflow-x-auto p-3">
        <SortableContext
          items={board.columns.map((c) => c.id)}
          strategy={horizontalListSortingStrategy}
        >
          {board.columns.map((column) => (
            <Column
              key={column.id}
              column={column}
              home={home}
              onAddCard={(columnId) => setDialog({ mode: 'create', columnId })}
              onEditCard={(cardId) => setDialog({ mode: 'edit', cardId })}
            />
          ))}
        </SortableContext>

        <button
          type="button"
          onClick={() => {
            const title = window.prompt('新欄位名稱')?.trim()
            if (title) addColumn(title)
          }}
          className="h-9 w-[160px] shrink-0 rounded-lg border border-dashed border-line text-[12px] text-fg-dim transition-colors hover:border-line-hover hover:text-fg"
        >
          ＋ 新增欄位
        </button>

        {dialog && (
          <CardDialog
            card={dialog.mode === 'edit' ? (board.cards[dialog.cardId] ?? null) : null}
            onCancel={() => setDialog(null)}
            onSubmit={submit}
            onDelete={
              dialog.mode === 'edit'
                ? () => {
                    deleteCard(dialog.cardId)
                    setDialog(null)
                  }
                : undefined
            }
          />
        )}
      </div>

      <DragOverlay>
        {draggingCardId && board.cards[draggingCardId] ? (
          <DragCardPreview card={board.cards[draggingCardId]} home={home} />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
```

- [ ] **Step 7: 手動驗證**

Run: `npm run dev`

在多個欄位放幾張卡片後，依序確認：

1. 卡片可拖到另一欄的指定位置，目標欄的卡片會即時讓位
2. 卡片可拖進空欄
3. 同欄內上下拖拉可重排
4. 拖曳中原位置變半透明，跟著游標的卡片傾斜 3° 且有陰影
5. 拖到一半按 Esc → 卡片回到原位
6. 拖曳欄位標題可調整欄位左右順序，卡片跟著整欄移動
7. 拖曳欄位標題以外的區域**不會**拖動欄位
8. 單擊卡片仍能選取（不會被誤判成拖曳）
9. 每次拖拉結束後 `cat ~/.sharkcommand/board.json` 確認順序已寫入；拖拉過程中檔案不應被反覆改寫

Run: `npm test && npm run typecheck`
Expected: 全綠、無型別錯誤

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: 卡片與欄位拖拉

@dnd-kit 支援卡片跨欄、卡片重排、欄位重排。
拖拉期間走 previewBoard 只更新畫面，放開才 commitBoard 存檔，
避免每幀丟 IPC。欄位僅標題為 drag handle，不與卡片拖拉打架。"
```

---

### Task 9: 終端機面板與 Splitter

**Files:**
- Create: `src/renderer/terminal/terminal-registry.ts`
- Create: `src/renderer/terminal/TerminalHost.tsx`
- Create: `src/renderer/terminal/TerminalHeader.tsx`
- Create: `src/renderer/terminal/TerminalPane.tsx`
- Create: `src/renderer/Splitter.tsx`
- Modify: `src/renderer/store/app-store.ts`（新增 `ptyStatus` 與 pty 相關 action）
- Modify: `src/renderer/App.tsx`（上下分割佈局、註冊 pty 事件）
- Modify: `src/renderer/styles/index.css`（引入 xterm 樣式）

**Interfaces:**
- Consumes: Task 6 的 `window.gc.pty.*`、Task 7 的 `useAppStore`
- Produces:
  - `ensureTerminal(cardId: string): { term: Terminal; fit: FitAddon }`
  - `getTerminal(cardId: string): { term: Terminal; fit: FitAddon } | undefined`
  - `hasTerminal(cardId: string): boolean`
  - `disposeTerminal(cardId: string): void`
  - `fitAndSync(cardId: string): void` — fit 後把新的 cols/rows 傳給 pty
  - store 新增 `ptyStatus: Record<string, PtyStatus>`
  - store 新增 `startPty(cardId)` / `stopPty(cardId)` / `setPtyStatus(cardId, status)`

**本任務的核心約束（實作前務必讀）：** xterm 實例存放在 module-level 的 `Map`，**不進 React state**。`TerminalHost` 對每個已啟動的卡片 render 一個容器 div 並全部保留掛載，非 active 的用 `absolute + opacity-0 + pointer-events-none` 隱藏。

**不可用 `display: none` 隱藏**——那會讓容器尺寸變成 0，xterm 的 `fit()` 會算出錯誤的 cols/rows，切回來時整個畫面排版壞掉。同理，**不可寫成 `{activeCard && <Terminal … />}`**，那樣每切一次卡片就 dispose 一個 xterm 實例，背景 session 的畫面全數遺失，而且不會有任何錯誤訊息。

- [ ] **Step 1: 撰寫 terminal-registry**

`src/renderer/terminal/terminal-registry.ts`：

```ts
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'

export interface TerminalEntry {
  term: Terminal
  fit: FitAddon
}

/** module-level Map：xterm 實例的生命週期與 React 元件樹完全脫鉤 */
const registry = new Map<string, TerminalEntry>()

export function ensureTerminal(cardId: string): TerminalEntry {
  const existing = registry.get(cardId)
  if (existing) return existing

  const term = new Terminal({
    fontFamily: '"SF Mono", Menlo, monospace',
    fontSize: 12,
    lineHeight: 1.2,
    scrollback: 5000,
    cursorBlink: true,
    theme: {
      background: '#0d1117',
      foreground: '#e6edf3',
      cursor: '#e6edf3',
      selectionBackground: '#30363d',
    },
  })

  const fit = new FitAddon()
  term.loadAddon(fit)

  // 使用者的每一次按鍵都轉發給 main 端的 pty
  term.onData((data) => window.gc.pty.write(cardId, data))

  const entry: TerminalEntry = { term, fit }
  registry.set(cardId, entry)
  return entry
}

export function getTerminal(cardId: string): TerminalEntry | undefined {
  return registry.get(cardId)
}

export function hasTerminal(cardId: string): boolean {
  return registry.has(cardId)
}

export function disposeTerminal(cardId: string): void {
  const entry = registry.get(cardId)
  if (!entry) return
  registry.delete(cardId)
  try {
    entry.term.dispose()
  } catch (err) {
    console.warn('[terminal-registry] dispose 失敗', { cardId, err })
  }
}

/**
 * 重新計算尺寸並同步給 pty。
 * 分隔線拖曳、視窗 resize、切換卡片三個時機都要呼叫，
 * 否則 Claude Code 的 TUI 會依舊尺寸繪製而排版錯亂。
 */
export function fitAndSync(cardId: string): void {
  const entry = registry.get(cardId)
  if (!entry) return
  try {
    entry.fit.fit()
    window.gc.pty.resize(cardId, entry.term.cols, entry.term.rows)
  } catch (err) {
    console.warn('[terminal-registry] fit 失敗', { cardId, err })
  }
}
```

- [ ] **Step 2: store 新增 pty 狀態與 action**

在 `src/renderer/store/app-store.ts` 頂端，把既有的 `import type { Board } from '@shared/types'` **改成**下面第一行（不是另外新增一行，否則會重複 import），並新增第二行：

```ts
import type { Board, PtyStatus } from '@shared/types'
import { disposeTerminal, ensureTerminal } from '../terminal/terminal-registry'
```

`AppState` 介面加入：

```ts
  /** key 為 cardId；沒有鍵代表從未啟動過 */
  ptyStatus: Record<string, PtyStatus>

  startPty: (cardId: string) => Promise<void>
  stopPty: (cardId: string) => void
  setPtyStatus: (cardId: string, status: PtyStatus) => void
```

初始值加入 `ptyStatus: {},`，並在 `return { ... }` 中加入實作：

```ts
    setPtyStatus: (cardId, status) =>
      set((state) => ({ ptyStatus: { ...state.ptyStatus, [cardId]: status } })),

    startPty: async (cardId) => {
      const card = get().board.cards[cardId]
      if (!card) {
        console.warn('[app-store] startPty 找不到卡片', { cardId })
        return
      }
      // 先確保 xterm 存在，才能拿到正確的 cols/rows 開 pty
      const { term } = ensureTerminal(cardId)
      try {
        await window.gc.pty.spawn(cardId, card.cwd, card.command, term.cols, term.rows)
        get().setPtyStatus(cardId, 'running')
      } catch (err) {
        console.error('[app-store] 啟動終端機失敗', { cardId, cwd: card.cwd, err })
        get().setPtyStatus(cardId, 'stopped')
      }
    },

    stopPty: (cardId) => {
      window.gc.pty.kill(cardId)
      get().setPtyStatus(cardId, 'stopped')
    },
```

同時修改既有的 `deleteCard`，在 kill 之後補上清除 xterm 實例（缺這行會造成記憶體洩漏）：

```ts
    deleteCard: (cardId) => {
      window.gc.pty.kill(cardId)
      disposeTerminal(cardId)
      const { activeCardId } = get()
      if (activeCardId === cardId) set({ activeCardId: null })
      set((state) => {
        const ptyStatus = { ...state.ptyStatus }
        delete ptyStatus[cardId]
        return { ptyStatus }
      })
      persist(deleteCard(get().board, cardId))
    },
```

以及 `deleteColumn` 中的迴圈：

```ts
      for (const cardId of result.removedCardIds) {
        window.gc.pty.kill(cardId)
        disposeTerminal(cardId)
      }
```

- [ ] **Step 3: 撰寫 TerminalHost**

`src/renderer/terminal/TerminalHost.tsx`：

```tsx
import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/app-store'
import { ensureTerminal, fitAndSync } from './terminal-registry'

interface SlotProps {
  cardId: string
  active: boolean
}

function TerminalSlot({ cardId, active }: SlotProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const opened = useRef(false)

  useEffect(() => {
    if (!ref.current || opened.current) return
    const { term } = ensureTerminal(cardId)
    term.open(ref.current)
    opened.current = true
    fitAndSync(cardId)
  }, [cardId])

  useEffect(() => {
    if (!active) return
    // 切回這張卡片時尺寸可能已經變過，重新 fit 並把新尺寸同步給 pty
    fitAndSync(cardId)
    ensureTerminal(cardId).term.focus()
  }, [active, cardId])

  return (
    <div
      ref={ref}
      // 隱藏用 opacity 而非 display:none——後者會讓容器尺寸歸零，fit 會算錯
      className={
        active
          ? 'absolute inset-0'
          : 'pointer-events-none absolute inset-0 -z-10 opacity-0'
      }
    />
  )
}

export default function TerminalHost(): JSX.Element {
  const activeCardId = useAppStore((s) => s.activeCardId)
  const ptyStatus = useAppStore((s) => s.ptyStatus)

  // 只要啟動過就保留容器，切換卡片不會 unmount 任何 xterm 實例
  const startedIds = Object.keys(ptyStatus)

  return (
    <div className="relative h-full w-full overflow-hidden bg-base">
      {startedIds.map((cardId) => (
        <TerminalSlot key={cardId} cardId={cardId} active={cardId === activeCardId} />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: 撰寫 TerminalHeader 與 TerminalPane**

`src/renderer/terminal/TerminalHeader.tsx`：

```tsx
import type { Card, PtyStatus } from '@shared/types'
import { useAppStore } from '../store/app-store'

interface Props {
  card: Card
  status: PtyStatus | undefined
}

export default function TerminalHeader({ card, status }: Props): JSX.Element {
  const startPty = useAppStore((s) => s.startPty)
  const stopPty = useAppStore((s) => s.stopPty)
  const alive = status === 'running' || status === 'idle'

  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line px-3">
      <span className="shrink-0 truncate text-[13px] text-fg">{card.title}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-dim">{card.cwd}</span>

      {alive ? (
        <>
          <button
            type="button"
            onClick={() => void startPty(card.id)}
            className="shrink-0 rounded border border-line px-2 py-0.5 text-[11px] text-fg-dim transition-colors hover:text-fg"
          >
            重啟
          </button>
          <button
            type="button"
            onClick={() => stopPty(card.id)}
            className="shrink-0 rounded border border-line px-2 py-0.5 text-[11px] text-fg-dim transition-colors hover:text-fg"
          >
            停止
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => void startPty(card.id)}
          className="shrink-0 rounded border border-line px-2 py-0.5 text-[11px] text-fg transition-colors hover:border-line-hover"
        >
          啟動
        </button>
      )}
    </div>
  )
}
```

`src/renderer/terminal/TerminalPane.tsx`：

```tsx
import { useAppStore } from '../store/app-store'
import TerminalHeader from './TerminalHeader'
import TerminalHost from './TerminalHost'

export default function TerminalPane(): JSX.Element {
  const activeCardId = useAppStore((s) => s.activeCardId)
  const card = useAppStore((s) => (s.activeCardId ? s.board.cards[s.activeCardId] : undefined))
  const status = useAppStore((s) => (s.activeCardId ? s.ptyStatus[s.activeCardId] : undefined))

  return (
    <div className="flex h-full flex-col bg-base">
      {card ? (
        <TerminalHeader card={card} status={status} />
      ) : (
        <div className="flex h-9 shrink-0 items-center border-b border-line px-3 text-[12px] text-fg-dim">
          {activeCardId ? '卡片已不存在' : '選擇一張卡片以開啟終端機'}
        </div>
      )}
      <div className="min-h-0 flex-1 p-2">
        <TerminalHost />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: 撰寫 Splitter**

`src/renderer/Splitter.tsx`：

```tsx
import { useCallback, useEffect, useRef } from 'react'

const STORAGE_KEY = 'sharkcommand.splitRatio'
const MIN_RATIO = 0.2
const MAX_RATIO = 0.8

export function loadSplitRatio(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const value = raw === null ? Number.NaN : Number.parseFloat(raw)
    if (Number.isNaN(value)) return 0.5
    return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value))
  } catch (err) {
    console.warn('[Splitter] 讀取分割比例失敗，使用預設值', { err })
    return 0.5
  }
}

interface Props {
  /** 拖曳中持續回報比例（0–1，看板佔的高度） */
  onChange: (ratio: number) => void
  /** 拖曳結束時呼叫，用來觸發 fit */
  onCommit: () => void
}

export default function Splitter({ onChange, onCommit }: Props): JSX.Element {
  const dragging = useRef(false)
  const lastRatio = useRef<number | null>(null)

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current) return
      const ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, e.clientY / window.innerHeight))
      lastRatio.current = ratio
      onChange(ratio)
    },
    [onChange],
  )

  const onPointerUp = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    document.body.style.cursor = ''
    // 拖曳結束才寫 localStorage——pointermove 每幀觸發，逐次寫入純屬浪費
    if (lastRatio.current !== null) {
      try {
        window.localStorage.setItem(STORAGE_KEY, String(lastRatio.current))
      } catch (err) {
        console.warn('[Splitter] 儲存分割比例失敗', { err })
      }
    }
    onCommit()
  }, [onCommit])

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [onPointerMove, onPointerUp])

  return (
    <div
      onPointerDown={() => {
        dragging.current = true
        document.body.style.cursor = 'row-resize'
      }}
      className="h-1 shrink-0 cursor-row-resize bg-line transition-colors hover:bg-line-hover"
    />
  )
}
```

- [ ] **Step 6: App.tsx 組合佈局並註冊 pty 事件**

`src/renderer/App.tsx`：

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import BoardPane from './board/BoardPane'
import RecoveryNotice from './RecoveryNotice'
import Splitter, { loadSplitRatio } from './Splitter'
import { useAppStore } from './store/app-store'
import TerminalPane from './terminal/TerminalPane'
import { fitAndSync, getTerminal } from './terminal/terminal-registry'

const RESIZE_DEBOUNCE_MS = 100

export default function App(): JSX.Element {
  const loaded = useAppStore((s) => s.loaded)
  const loadBoard = useAppStore((s) => s.loadBoard)
  const setPtyStatus = useAppStore((s) => s.setPtyStatus)
  const [home, setHome] = useState('')
  const [ratio, setRatio] = useState(loadSplitRatio)
  const resizeTimer = useRef<number | null>(null)

  useEffect(() => {
    void loadBoard()
    setHome(window.gc.homeDir())
  }, [loadBoard])

  // pty 的輸出直接寫進對應的 xterm；結束時把卡片轉為 stopped
  useEffect(() => {
    const offData = window.gc.onPtyData((cardId, data) => {
      getTerminal(cardId)?.term.write(data)
    })
    const offExit = window.gc.onPtyExit((cardId) => {
      setPtyStatus(cardId, 'stopped')
    })
    return () => {
      offData()
      offExit()
    }
  }, [setPtyStatus])

  /** 視窗或分割比例變動後重新 fit；debounce 100ms 避免對 pty 狂發 resize */
  const scheduleFit = useCallback(() => {
    if (resizeTimer.current !== null) window.clearTimeout(resizeTimer.current)
    resizeTimer.current = window.setTimeout(() => {
      const { activeCardId } = useAppStore.getState()
      if (activeCardId) fitAndSync(activeCardId)
    }, RESIZE_DEBOUNCE_MS)
  }, [])

  useEffect(() => {
    window.addEventListener('resize', scheduleFit)
    return () => window.removeEventListener('resize', scheduleFit)
  }, [scheduleFit])

  if (!loaded) {
    return <div className="flex h-full items-center justify-center text-fg-dim">載入中…</div>
  }

  return (
    <div className="flex h-full flex-col bg-base">
      <RecoveryNotice />
      {/* 用 flexGrow 而非百分比高度，橫幅出現時上下比例不會跑掉 */}
      <div style={{ flexGrow: ratio, flexBasis: 0 }} className="min-h-0">
        <BoardPane home={home} />
      </div>
      <Splitter
        onChange={(next) => {
          setRatio(next)
          scheduleFit()
        }}
        onCommit={scheduleFit}
      />
      <div style={{ flexGrow: 1 - ratio, flexBasis: 0 }} className="min-h-0">
        <TerminalPane />
      </div>
    </div>
  )
}
```

- [ ] **Step 7: 引入 xterm 樣式**

在 `src/renderer/styles/index.css` 的 `@tailwind` 三行之前加入：

```css
@import '@xterm/xterm/css/xterm.css';
```

- [ ] **Step 8: 手動驗證**

Run: `npm run dev`

依序確認：

1. 建一張 cwd 指向真實專案的卡片，點選後按「啟動」→ 終端機出現 shell 並自動執行 `claude`
2. 在終端機正常輸入互動，Claude Code 的介面（含選單、色彩）顯示正確
3. **關鍵驗證**：啟動兩張卡片各跑 `claude`，在 A 卡輸入指令讓它產出內容，切到 B 卡再切回 A → **A 的畫面完整保留**，沒有清空
4. 拖曳分隔線改變高度 → 放開後終端機內容重新排版且不亂碼；Claude Code 的介面寬度正確跟隨
5. 調整視窗大小 → 同上
6. 按「停止」→ 終端機停止，按鈕變回「啟動」
7. 按「重啟」→ 開新的 session
8. 在終端機輸入 `exit` → 按鈕自動變回「啟動」
9. 重開 app，確認分隔線位置保留
10. ⌘Q 後執行 `pgrep -fl "zsh -l"` → 沒有殘留程序

Run: `npm test && npm run typecheck`
Expected: 全綠、無型別錯誤

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: 內嵌終端機與分隔線

xterm 實例存於 module-level Map 常駐，非 active 以 opacity 隱藏
而非 display:none，切換卡片不會遺失任何 session 畫面。
fit 後同步 cols/rows 給 pty，resize 一律 debounce 100ms。"
```

---

### Task 10: 狀態燈與 git branch 顯示

**Files:**
- Create: `src/renderer/store/pty-activity.ts`
- Create: `src/renderer/board/StatusDot.tsx`
- Test: `tests/renderer/pty-activity.test.ts`
- Modify: `src/renderer/store/app-store.ts`（新增 `branches`、`refreshPtyStatuses`、`loadBranches`）
- Modify: `src/renderer/board/CardItem.tsx`（顯示狀態燈與 branch）
- Modify: `src/renderer/board/Column.tsx`（把 status 與 branch 傳給卡片）
- Modify: `src/renderer/App.tsx`（狀態輪詢與 branch 定期刷新）
- Modify: `src/renderer/styles/index.css`（呼吸動畫）

**Interfaces:**
- Consumes: Task 9 的 `ptyStatus`、Task 6 的 `window.gc.git.branch`
- Produces:
  - `IDLE_THRESHOLD_MS = 2000`
  - `markOutput(cardId: string, now: number): void`
  - `clearActivity(cardId: string): void`
  - `computeStatus(cardId: string, alive: boolean, now: number): PtyStatus`
  - store 新增 `branches: Record<string, string | null>`（key 為 cwd）
  - store 新增 `refreshPtyStatuses(): void`、`loadBranches(): Promise<void>`
  - `<StatusDot status={status} />`

**效能關鍵：** 最後輸出時間存在 module-level 的 `Map`，**不放進 zustand**。pty 的 data 事件可能一秒觸發上百次，每次都 `set` state 會讓整個看板狂重繪。改成由一個 500ms 的輪詢統一計算狀態，且只在真的有變化時才 `set` — 重繪頻率因此固定在 2Hz。

- [ ] **Step 1: 撰寫失敗的測試**

`tests/renderer/pty-activity.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import {
  IDLE_THRESHOLD_MS,
  clearActivity,
  computeStatus,
  markOutput,
} from '../../src/renderer/store/pty-activity'

beforeEach(() => {
  clearActivity('card_a')
})

describe('computeStatus', () => {
  it('pty 不存活時一律為 stopped，即使剛有輸出', () => {
    markOutput('card_a', 1000)
    expect(computeStatus('card_a', false, 1000)).toBe('stopped')
  })

  it('存活但從未有輸出時為 idle', () => {
    expect(computeStatus('card_a', true, 1000)).toBe('idle')
  })

  it('門檻內有輸出時為 running', () => {
    markOutput('card_a', 1000)
    expect(computeStatus('card_a', true, 1000 + IDLE_THRESHOLD_MS - 1)).toBe('running')
  })

  it('剛好達到門檻時轉為 idle', () => {
    markOutput('card_a', 1000)
    expect(computeStatus('card_a', true, 1000 + IDLE_THRESHOLD_MS)).toBe('idle')
  })

  it('超過門檻後為 idle，再次輸出又轉回 running', () => {
    markOutput('card_a', 1000)
    expect(computeStatus('card_a', true, 5000)).toBe('idle')
    markOutput('card_a', 5000)
    expect(computeStatus('card_a', true, 5100)).toBe('running')
  })

  it('clearActivity 後回到從未輸出的狀態', () => {
    markOutput('card_a', 1000)
    clearActivity('card_a')
    expect(computeStatus('card_a', true, 1100)).toBe('idle')
  })

  it('門檻為 spec 定義的 2000ms', () => {
    expect(IDLE_THRESHOLD_MS).toBe(2000)
  })
})
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -- pty-activity`
Expected: FAIL — 無法解析 `../../src/renderer/store/pty-activity`

- [ ] **Step 3: 實作 pty-activity**

`src/renderer/store/pty-activity.ts`：

```ts
import type { PtyStatus } from '@shared/types'

/** 最近一次輸出距今超過這個時間即視為 idle */
export const IDLE_THRESHOLD_MS = 2000

/**
 * 最後輸出時間存在 module-level Map 而非 zustand。
 * pty 的 data 事件一秒可能上百次，逐次 set state 會讓整個看板狂重繪。
 */
const lastOutputAt = new Map<string, number>()

export function markOutput(cardId: string, now: number): void {
  lastOutputAt.set(cardId, now)
}

export function clearActivity(cardId: string): void {
  lastOutputAt.delete(cardId)
}

export function computeStatus(cardId: string, alive: boolean, now: number): PtyStatus {
  if (!alive) return 'stopped'
  const last = lastOutputAt.get(cardId)
  if (last === undefined) return 'idle'
  return now - last < IDLE_THRESHOLD_MS ? 'running' : 'idle'
}
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -- pty-activity`
Expected: PASS — 7 個測試全綠

- [ ] **Step 5: store 新增狀態輪詢與 branch 快取**

在 `src/renderer/store/app-store.ts` 補上 import：

```ts
import { clearActivity, computeStatus } from './pty-activity'
```

`AppState` 介面加入：

```ts
  /** key 為 cwd，多張卡片指向同一目錄時共用 */
  branches: Record<string, string | null>

  refreshPtyStatuses: () => void
  loadBranches: () => Promise<void>
```

初始值加入 `branches: {},`，並加入實作：

```ts
    /** 每 500ms 由 App 呼叫；只在真的有變化時才 set，避免無謂重繪 */
    refreshPtyStatuses: () => {
      const { ptyStatus } = get()
      const now = Date.now()
      const next: Record<string, PtyStatus> = {}
      let changed = false

      for (const [cardId, current] of Object.entries(ptyStatus)) {
        const status = computeStatus(cardId, current !== 'stopped', now)
        next[cardId] = status
        if (status !== current) changed = true
      }

      if (changed) set({ ptyStatus: next })
    },

    loadBranches: async () => {
      const cwds = [...new Set(Object.values(get().board.cards).map((c) => c.cwd))]
      try {
        const entries = await Promise.all(
          cwds.map(async (cwd) => [cwd, await window.gc.git.branch(cwd)] as const),
        )
        set({ branches: Object.fromEntries(entries) })
      } catch (err) {
        console.warn('[app-store] 讀取 branch 失敗，卡片將不顯示 branch', { err })
      }
    },
```

同時在 `deleteCard` 與 `deleteColumn` 清除 xterm 實例的地方，一併清掉活動紀錄，避免 Map 殘留已刪除的卡片。`deleteCard` 中改成：

```ts
      window.gc.pty.kill(cardId)
      disposeTerminal(cardId)
      clearActivity(cardId)
```

`deleteColumn` 的迴圈改成：

```ts
      for (const cardId of result.removedCardIds) {
        window.gc.pty.kill(cardId)
        disposeTerminal(cardId)
        clearActivity(cardId)
      }
```

- [ ] **Step 6: 撰寫 StatusDot 與呼吸動畫**

`src/renderer/board/StatusDot.tsx`：

```tsx
import type { PtyStatus } from '@shared/types'

const STYLE: Record<PtyStatus, { color: string; label: string; breathe: boolean }> = {
  running: { color: '#3fb950', label: '執行中', breathe: true },
  idle: { color: '#d29922', label: '閒置', breathe: false },
  stopped: { color: '#6e7681', label: '已停止', breathe: false },
}

interface Props {
  /** undefined 代表從未啟動過，視覺上與 stopped 相同 */
  status: PtyStatus | undefined
}

export default function StatusDot({ status }: Props): JSX.Element {
  const style = STYLE[status ?? 'stopped']
  return (
    <span
      title={status === undefined ? '尚未啟動' : style.label}
      style={{ backgroundColor: style.color }}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${style.breathe ? 'animate-breathe' : ''}`}
    />
  )
}
```

在 `src/renderer/styles/index.css` 末端加入：

```css
/* 呼吸而非閃爍——一堆卡片同時閃爍在餘光中很干擾 */
@keyframes breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.animate-breathe {
  animation: breathe 2s ease-in-out infinite;
}
```

- [ ] **Step 7: CardItem 顯示狀態燈與 branch**

`src/renderer/board/CardItem.tsx` — Props 加入兩個欄位：

```ts
interface Props {
  card: Card
  columnId: string
  active: boolean
  home: string
  status: PtyStatus | undefined
  /** undefined 代表尚未查詢，null 代表非 git 目錄 */
  branch: string | null | undefined
  onSelect: () => void
  onEdit: () => void
}
```

補上 import：

```tsx
import type { Card, PtyStatus } from '@shared/types'
import StatusDot from './StatusDot'
```

把元件內部的兩行內容改成：

```tsx
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-fg">{card.title}</span>
        <StatusDot status={status} />
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] leading-4 text-fg-dim">
        <span className="min-w-0 truncate">{shortenPath(card.cwd, home)}</span>
        {branch && (
          <span className="shrink-0 truncate rounded bg-base px-1 text-[10px]" title={branch}>
            {branch}
          </span>
        )}
      </div>
```

- [ ] **Step 8: Column 傳入 status 與 branch**

在 `src/renderer/board/Column.tsx` 的元件內取用 store：

```tsx
  const ptyStatus = useAppStore((s) => s.ptyStatus)
  const branches = useAppStore((s) => s.branches)
```

並在 `<CardItem … />` 加上兩個 prop：

```tsx
              status={ptyStatus[cardId]}
              branch={branches[card.cwd]}
```

- [ ] **Step 9: App.tsx 接上輪詢與 branch 刷新**

在 `src/renderer/App.tsx` 補上 import：

```tsx
import { markOutput } from './store/pty-activity'
```

把 pty 事件的 `useEffect` 改成同時記錄輸出時間：

```tsx
  useEffect(() => {
    const offData = window.gc.onPtyData((cardId, data) => {
      getTerminal(cardId)?.term.write(data)
      markOutput(cardId, Date.now())
    })
    const offExit = window.gc.onPtyExit((cardId) => {
      setPtyStatus(cardId, 'stopped')
    })
    return () => {
      offData()
      offExit()
    }
  }, [setPtyStatus])
```

新增兩個定時器：

```tsx
  // 狀態燈：500ms 輪詢一次，store 只在狀態真的變化時才更新
  useEffect(() => {
    const timer = window.setInterval(() => {
      useAppStore.getState().refreshPtyStatuses()
    }, 500)
    return () => window.clearInterval(timer)
  }, [])

  // branch：載入後抓一次，之後每 30 秒刷新，checkout 後卡片會自動跟上
  useEffect(() => {
    if (!loaded) return
    void useAppStore.getState().loadBranches()
    const timer = window.setInterval(() => {
      void useAppStore.getState().loadBranches()
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [loaded])
```

- [ ] **Step 10: 手動驗證**

Run: `npm run dev`

依序確認：

1. 未啟動的卡片顯示灰點，tooltip 為「尚未啟動」
2. 啟動後 Claude 正在輸出時顯示綠點且緩慢呼吸（非閃爍）
3. Claude 停止輸出約 2 秒後轉為靜態黃點
4. 在終端機輸入 `exit` → 轉為灰點
5. cwd 指向 git repo 的卡片顯示 branch 標籤；指向非 repo 的不顯示
6. 在該 repo 執行 `git checkout -b test-branch`，等待最多 30 秒 → 卡片的 branch 自動更新
7. 開啟 DevTools 的 Performance，啟動一個持續輸出的指令（如 `yes`），確認看板沒有明顯掉幀

Run: `npm test && npm run typecheck`
Expected: 全綠、無型別錯誤

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: 狀態燈與 git branch 顯示

輸出時間存 module-level Map，由 500ms 輪詢統一計算狀態，
只在變化時才更新 store，重繪頻率固定 2Hz。
running 用 2 秒週期呼吸動畫，避免多卡同時閃爍造成干擾。"
```

---

### Task 11: ⌘K 快速跳轉、打包與 README

**Files:**
- Create: `src/renderer/CommandPalette.tsx`
- Create: `electron-builder.yml`
- Create: `README.md`
- Test: `tests/renderer/fuzzy.test.ts`
- Create: `src/renderer/fuzzy.ts`
- Modify: `src/renderer/App.tsx`（掛上 ⌘K）

**Interfaces:**
- Consumes: Task 7 的 `useAppStore`
- Produces:
  - `fuzzyMatch(query: string, target: string): boolean`
  - `<CommandPalette open={boolean} onClose={() => void} home={string} />`

- [ ] **Step 1: 撰寫模糊搜尋的失敗測試**

`tests/renderer/fuzzy.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { fuzzyMatch } from '../../src/renderer/fuzzy'

describe('fuzzyMatch', () => {
  it('空查詢符合任何目標', () => {
    expect(fuzzyMatch('', 'U19 登入重構')).toBe(true)
  })

  it('連續子字串符合', () => {
    expect(fuzzyMatch('登入', 'U19 登入重構')).toBe(true)
  })

  it('不連續但順序正確的字元符合', () => {
    expect(fuzzyMatch('u19構', 'U19 登入重構')).toBe(true)
    expect(fuzzyMatch('pbp', 'play-by-play 重構')).toBe(true)
  })

  it('忽略大小寫', () => {
    expect(fuzzyMatch('U19', 'u19 登入重構')).toBe(true)
    expect(fuzzyMatch('u19', 'U19 登入重構')).toBe(true)
  })

  it('順序錯誤不符合', () => {
    expect(fuzzyMatch('構登', 'U19 登入重構')).toBe(false)
  })

  it('目標不含查詢字元時不符合', () => {
    expect(fuzzyMatch('xyz', 'U19 登入重構')).toBe(false)
  })

  it('查詢比目標長時不符合', () => {
    expect(fuzzyMatch('登入重構流程', '登入')).toBe(false)
  })
})
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -- fuzzy`
Expected: FAIL — 無法解析 `../../src/renderer/fuzzy`

- [ ] **Step 3: 實作 fuzzyMatch**

`src/renderer/fuzzy.ts`：

```ts
/**
 * 子序列比對：query 的字元需依序出現在 target 中，允許中間有其他字元。
 * 逐字元比對，中文與英文一體適用。
 */
export function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase()
  if (q === '') return true

  const t = target.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi += 1
  }
  return qi === q.length
}
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -- fuzzy`
Expected: PASS — 7 個測試全綠

- [ ] **Step 5: 撰寫 CommandPalette**

`src/renderer/CommandPalette.tsx`：

```tsx
import { useEffect, useMemo, useState } from 'react'
import type { Card } from '@shared/types'
import StatusDot from './board/StatusDot'
import { shortenPath } from './board/CardItem'
import { fuzzyMatch } from './fuzzy'
import { useAppStore } from './store/app-store'

interface Props {
  open: boolean
  onClose: () => void
  home: string
}

export default function CommandPalette({ open, onClose, home }: Props): JSX.Element | null {
  const board = useAppStore((s) => s.board)
  const ptyStatus = useAppStore((s) => s.ptyStatus)
  const setActiveCard = useAppStore((s) => s.setActiveCard)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)

  /** 依看板順序列出卡片，並附上所屬欄位名稱 */
  const rows = useMemo(() => {
    const all: Array<{ card: Card; columnTitle: string }> = []
    for (const column of board.columns) {
      for (const cardId of column.cardIds) {
        const card = board.cards[cardId]
        if (card) all.push({ card, columnTitle: column.title })
      }
    }
    return all.filter(
      ({ card }) => fuzzyMatch(query, card.title) || fuzzyMatch(query, card.cwd),
    )
  }, [board, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
    }
  }, [open])

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, rows.length - 1)))
  }, [rows.length])

  if (!open) return null

  const choose = (cardId: string): void => {
    setActiveCard(cardId)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[15vh]" onClick={onClose}>
      <div
        className="w-[520px] overflow-hidden rounded-lg border border-line bg-column"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor((c) => Math.min(c + 1, rows.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor((c) => Math.max(c - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const row = rows[cursor]
              if (row) choose(row.card.id)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
          placeholder="搜尋卡片標題或路徑…"
          className="w-full border-b border-line bg-column px-4 py-3 text-[14px] text-fg outline-none"
        />

        <div className="max-h-[320px] overflow-y-auto">
          {rows.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-fg-dim">沒有符合的卡片</div>
          ) : (
            rows.map((row, index) => (
              <button
                key={row.card.id}
                type="button"
                onMouseEnter={() => setCursor(index)}
                onClick={() => choose(row.card.id)}
                className={`flex w-full items-center gap-2 px-4 py-2 text-left ${
                  index === cursor ? 'bg-card' : ''
                }`}
              >
                <StatusDot status={ptyStatus[row.card.id]} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{row.card.title}</span>
                <span className="shrink-0 font-mono text-[11px] text-fg-dim">
                  {shortenPath(row.card.cwd, home)}
                </span>
                <span className="shrink-0 text-[11px] text-fg-dim">{row.columnTitle}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: App.tsx 掛上 ⌘K**

在 `src/renderer/App.tsx` 補上 import 與狀態：

```tsx
import CommandPalette from './CommandPalette'
```

```tsx
  const [paletteOpen, setPaletteOpen] = useState(false)
```

新增快捷鍵監聽：

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
```

在最外層 `<div>` 內、`</div>` 之前加入：

```tsx
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} home={home} />
```

**注意**：xterm 有焦點時鍵盤事件會先進終端機。`window` 上的 `keydown` 監聽在冒泡階段仍收得到 ⌘K，因為 xterm 不會對含 `metaKey` 的組合鍵呼叫 `preventDefault`。驗證時務必在終端機有焦點的狀態下測一次。

- [ ] **Step 7: 撰寫 electron-builder 設定**

`electron-builder.yml`：

```yaml
appId: com.shark.sharkcommand
productName: SharkCommand

directories:
  output: release

files:
  - out/**/*
  - package.json

# node-pty 是 native addon，必須解壓在 asar 之外才能被 dlopen
asarUnpack:
  - '**/node_modules/node-pty/**'

mac:
  category: public.app-category.developer-tools
  target:
    - target: dmg
      arch:
        - universal
```

- [ ] **Step 8: 打包並驗證**

Run: `npm run build:mac`
Expected: `release/SharkCommand-0.1.0-universal.dmg` 產生

**若 universal 打包因 `node-pty` 失敗**（native addon 的 universal 合併偶爾會在 lipo 階段出錯），把 `electron-builder.yml` 的 `arch` 改成分別出兩包：

```yaml
      arch:
        - arm64
        - x64
```

這樣會產生兩個 `.dmg`，README 需說明 Apple Silicon 與 Intel 各下載哪一個。功能完全相同，只是分發時多一個選擇步驟。

驗證安裝包：

```bash
open release/
# 掛載 dmg、把 SharkCommand.app 拖進 Applications
xattr -dr com.apple.quarantine /Applications/SharkCommand.app
open /Applications/SharkCommand.app
```

Expected: app 正常啟動，能建立卡片並啟動終端機執行 `claude`（這一步是在驗證打包後的 `node-pty` 確實可用）

- [ ] **Step 9: 撰寫 README**

`README.md`：

````markdown
# SharkCommand

以 Trello 式看板管理多個 Claude Code session 的 macOS 應用。欄位代表工作階段，卡片代表一個內嵌終端機 session，拖拉卡片即可推進階段。

## 為什麼做這個

同時跑十幾個 Claude Code session 時，終端機的分頁是一維水平排開的：看不出哪個在哪個階段，也分不清哪個分頁在做什麼。SharkCommand 用二維看板取代那條 tab bar。

## 功能

- 自訂工作階段欄位（預設：需求評估中 / 開發中 / Review 中 / 等待 Merge）
- 卡片可跨欄拖拉、同欄重排；欄位本身也可拖拉調整順序
- 每張卡片是一個內嵌終端機，記住工作目錄與啟動指令
- 狀態燈一眼看出執行中 / 閒置 / 已停止
- 卡片顯示所在 git branch（支援 worktree）
- ⌘K 模糊搜尋快速跳轉

## 開發

需要 Node 20 以上。

```bash
npm install
npm run dev
```

其他指令：

```bash
npm test          # 執行測試
npm run typecheck # 型別檢查
npm run build:mac # 打包成 .dmg
```

## 安裝（給拿到 .dmg 的人）

1. 掛載 `.dmg`，把 `SharkCommand.app` 拖進「應用程式」
2. 這個 app 沒有經過 Apple 簽名，第一次開啟會被 Gatekeeper 擋下並顯示「無法驗證開發者」。執行以下指令解除，一次就好：

```bash
xattr -dr com.apple.quarantine /Applications/SharkCommand.app
```

3. 正常開啟

## 資料存放

看板資料存在 `~/.sharkcommand/board.json`，純文字 JSON，可自行編輯或備份。檔案損毀時會自動備份成 `board.json.corrupt-<timestamp>` 並回退成預設看板。

## 已知限制

- 關閉 app 會關掉所有終端機 session，session 不會保活
- 狀態燈只反映「有沒有輸出在流動」，不會判斷 Claude 是否正在等你回答
````

- [ ] **Step 10: 全面驗證**

Run: `npm test && npm run typecheck`
Expected: 全綠、無型別錯誤

Run: `npm run dev`

最終確認清單：

1. 按 ⌘K → 搜尋面板開啟，輸入兩三個字能命中卡片
2. 上下鍵移動選取、Enter 跳轉到該卡片、Esc 關閉
3. 在終端機有焦點的狀態下按 ⌘K → 仍能開啟
4. 搜尋結果顯示狀態燈、路徑與所在欄位
5. 建立 8 張以上卡片分散在各欄，確認一欄能舒服容納且不需捲動就看得到多張

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: ⌘K 快速跳轉、打包設定與 README

fuzzyMatch 採子序列比對，中英文一體適用。
electron-builder 產出 universal dmg，node-pty 以 asarUnpack 排除。
README 說明 Gatekeeper 解除方式。"
```

---

## 完成後的狀態

- 11 個任務全部完成後，MVP 範圍內的功能齊備，可產出 `.dmg` 分發
- 自動化測試涵蓋：factory、board reducer、git branch 解析、board 持久化、pty 生命週期、狀態判定、模糊搜尋
- UI 行為以各任務的手動驗證清單確認

spec 中明確排除至 v2 的項目（session 保活、`claude --resume` 整合、「等你回答」語意偵測、完成通知、單卡多分頁、亮色主題、GitHub Actions 自動 release）**不在**本計畫範圍內。
