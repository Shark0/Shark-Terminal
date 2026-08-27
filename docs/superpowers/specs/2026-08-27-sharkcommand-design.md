# SharkCommand 設計文件

日期：2026-08-27

## 1. 問題與目標

同時進行多個 Claude Code session 時，現行終端機的使用方式有三個問題：

1. **session 數量過多**，開了十幾個分頁後無法掌握全貌
2. **階段不可控** — 每個 session 進行到哪個工作階段（需求評估 / 開發 / Review / 等待 Merge）沒有地方記錄
3. **分頁水平排開** — 終端機的 tab bar 是一維的，塞滿後既看不出結構，也分不清哪個分頁在做什麼

SharkCommand 是一個 macOS 桌面應用，用看板的二維佈局取代終端機一維的 tab bar：**欄位代表工作階段，卡片代表一個 Claude Code session**，卡片可拖拉跨欄以推進階段。

### 成功標準

- 一眼掃過看板即可知道所有 session 分別處於哪個階段、哪些正在執行
- 內嵌終端機操作 Claude Code 的體驗與原生終端機無異
- 可打包成 `.dmg` 分發給朋友，對方不需安裝任何開發工具

### 非目標

- 不做多人協作、不做雲端同步（單機單使用者工具）
- 不取代 git 工作流，看板階段純粹是使用者自己的心智標記

## 2. 技術選型

| 項目 | 選擇 | 理由 |
|---|---|---|
| 殼 | Electron | `node-pty` 是 VS Code terminal 的底層，處理 PTY resize、ANSI、TUI 最成熟。整個專案成敗押在「內嵌終端機跑 Claude Code 要跟原生一樣好用」，這條路最沒有意外 |
| 前端 | React + TypeScript | 與既有技術棧一致 |
| 建置 | electron-vite | main / preload / renderer 三端 build 已配好 |
| 終端機 | xterm.js + node-pty | 業界標準組合 |
| 拖拉 | @dnd-kit | 一套 API 同時支援卡片跨欄、卡片重排、欄位重排 |
| 狀態 | zustand | 拖拉高頻更新，避免 Context 整棵樹重繪 |
| 樣式 | Tailwind + 獨立 CSS（xterm 客製） | 與既有技術棧一致；xterm 的 DOM 由函式庫產生，其客製走獨立 CSS |
| 測試 | Vitest | 與 Vite 建置共用設定，純函式測試啟動快 |
| 打包 | electron-builder | arm64 與 x64 各一包 `.dmg`（見下方說明） |

### 被否決的方案

**Tauri 2 + portable-pty**：殼只吃 ~40MB、打包 ~10MB，但 PTY 那層要寫 Rust。`portable-pty` 在 TUI 邊緣情境（滑鼠事件、alternate screen）踩雷時需自行以 Rust 除錯。為省 ~150MB 記憶體，把風險押在最不想除錯的那一層，不划算。

**本機 Web app（Node/Bun server + 瀏覽器）**：瀏覽器分頁本身也是水平排開的，與核心痛點自相矛盾；且 ⌘W / ⌘T 等快捷鍵會被瀏覽器攔截，終端機體驗殘缺。

## 3. 資料模型

檔案位置：`~/.sharkcommand/board.json`（使用者家目錄，不進 repo，讓每個使用者有自己的看板）

```jsonc
{
  "version": 1,
  "columns": [                         // 陣列順序 = 欄位左右順序
    {
      "id": "col_a1b2",
      "title": "需求評估中",
      "color": "#58a6ff",              // 欄頭色帶
      "cardIds": ["card_x", "card_y"]  // 陣列順序 = 卡片上下順序
    }
  ],
  "cards": {                           // map，用 id 查
    "card_x": {
      "id": "card_x",
      "title": "訂單結帳重構",
      "cwd": "/Users/me/projects/checkout-service",
      "command": "claude",             // 啟動指令；可自行改成任何 shell 指令
      "note": "",
      "createdAt": "2026-08-27T08:00:00Z",
      "updatedAt": "2026-08-27T08:00:00Z"
    }
  }
}
```

### 設計決策

**卡片順序存在 column 的 `cardIds` 陣列裡，不存 order 數字。** Trello 的 lexorank 排序是為了多人同時拖拉不衝突，單機單使用者用不到。拖拉即是從 A 欄陣列 splice、insert 進 B 欄陣列，永遠不需重算 order。

**runtime 狀態完全不進 JSON。** pty 的 pid、輸出 buffer、running/idle 狀態只活在記憶體。JSON 只存靜態設定（含重建 session 所需的 `cwd` + `command`），不存任何 runtime 狀態，避免出現「app crash 後 JSON 裡躺著死掉的 pid」這類無效狀態。

**寫檔 debounce 500ms。** 拖拉過程中 state 每幀變動，不 debounce 會狂寫磁碟。

**JSON 損毀時的容錯**：讀取失敗或格式驗證不過時，不可讓 app 開不起來。行為是備份原檔為 `board.json.corrupt-<timestamp>`，回退成預設看板，並在 UI 顯示一則可關閉的提示，告知備份檔位置。

### 初次啟動與欄位顏色

`~/.sharkcommand/board.json` 不存在時，建立**完全空白**的看板（沒有任何欄位），由使用者自行建立需要的階段。

原本規劃預設四個欄位（需求評估中／開發中／Review 中／等待 Merge），實際使用後改掉：每個人的工作流不同，預設階段是強加的假設，開啟後第一件事反而變成刪掉不要的欄位。

新增欄位時的顏色從一組預設色盤依序循環取用（藍 `#58a6ff`、綠 `#3fb950`、紫 `#bc8cff`、橙 `#d29922`、粉 `#f778ba`、青 `#39c5cf`），確保相鄰欄位不同色，之後可手動改。

### 卡片顯示的資訊

標題、`cwd`（縮寫為 `~/checkout-service`）、**git branch**、狀態燈。

branch 靠讀 `.git/HEAD` 第一行取得，成本近乎零，但對辨識卡片幫助極大（同一個 repo 的主目錄與多個 worktree，branch 是最有效的區分依據）。需處理的情境：

- 一般 repo：`.git/HEAD` 內容為 `ref: refs/heads/<branch>`
- worktree：`.git` 是**檔案**而非目錄，內容為 `gitdir: <path>`，需再往該路徑讀 HEAD
- detached HEAD：`HEAD` 直接是 commit SHA，顯示前 7 碼
- 非 git 目錄：不顯示 branch 欄位

## 4. 程序架構

### 職責切分

| 程序 | 擁有什麼 |
|---|---|
| **main** | 所有 pty 實例、`board.json` 讀寫、git branch 讀取、app 生命週期 |
| **preload** | `contextBridge` 暴露的型別化 IPC API，別無他物 |
| **renderer** | React 看板、xterm.js 實例、拖拉狀態 |

`contextIsolation: true` / `nodeIntegration: false`。renderer 碰不到 Node — 這不只是安全考量，`node-pty` 本來就只能在 main 執行。

### IPC 介面

preload 經 `contextBridge` 暴露的全部 API：

```ts
window.gc = {
  board: { load, save },                    // JSON 讀寫
  pty:   { spawn, write, resize, kill },    // 一律以 cardId 為 key
  onPtyData:  (cb) => unsubscribe,          // main → renderer 串流
  onPtyExit:  (cb) => unsubscribe,
  git:   { branch(cwd) },
}
```

### xterm 實例策略

**每張卡片配一個常駐的 xterm.js 實例**，非 active 的容器留在 DOM 但視覺隱藏，切換卡片只是切換哪個可見。

**否決的替代方案**：只留一個 xterm 實例，切換時從 main 端的 ring buffer 重播歷史。記憶體省很多，但 Claude Code 是 TUI，會使用 alternate screen 並頻繁重繪 — 從一段被截斷的 buffer 重播 ANSI 序列，終端機狀態機的起點是錯的，畫面會壞。要做對需在 main 端跑 `@xterm/headless` + serialize addon（VS Code 的做法），複雜度不值得 MVP 承擔。

**已知代價**：一個 xterm 實例約 5–15MB，20 張卡約 100–300MB。若實測開到二三十個 session 出現卡頓，升級路徑是換成 headless + serialize，屆時資料模型不需變動。

### PTY 生命週期

- 建立卡片時**不**自動 spawn — 卡片可以純粹是「待辦」，點「啟動」才真的開 session
- spawn 時以卡片的 `cwd` 為工作目錄，執行卡片的 `command`
- 刪除卡片 → kill pty
- app quit → 攔截 `before-quit`，全部送 SIGTERM，500ms 後仍存活者送 SIGKILL
- pty 自行結束（使用者輸入 `exit` 或 crash）→ 卡片轉 `stopped`，保留最後畫面，可一鍵重啟

### 狀態燈

| 燈 | 判定條件 |
|---|---|
| 🟢 running | 最近 2 秒內有 output |
| 🟡 idle | pty 存活但超過 2 秒無 output |
| ⚪ stopped | pty 不存在或已結束 |

純粹依 output 有無流動判定，不解析內容 — 便宜且不會誤判。「Claude 正在等你回答」這類語意判斷需對輸出做 pattern match，Claude Code 版本一改就失準，不納入 MVP。

## 5. UI 設計

### 元件樹

```
App
├─ BoardPane                    上半：看板
│  ├─ Column ×N
│  │  ├─ ColumnHeader           色帶、標題（雙擊可改）、卡片數、＋新增卡片
│  │  └─ CardItem ×N            可拖拉
│  └─ AddColumnButton
├─ Splitter                     可拖曳分隔線，比例存 localStorage
└─ TerminalPane                 下半：終端機
   ├─ TerminalHeader            卡片標題 · ~/cwd · branch · [啟動][重啟][停止]
   └─ TerminalHost              ★ 所有 xterm 容器掛載於此
```

### TerminalHost 的核心約束

`TerminalHost` 必須永遠掛載，且 render **所有已啟動卡片**的容器 div（`key={cardId}`），非 active 的以 CSS 隱藏。xterm 實例存放於 module-level 的 `Map<cardId, Terminal>`，**不進 React state**。

**必須避免的寫法**：`{activeCard && <Terminal card={activeCard} />}`。這樣每切換一次卡片就 unmount 掉一個 xterm 實例，背景 session 的畫面全數遺失。此錯誤在功能上不會報錯，只會在切回去時發現終端機是空的。

### 拖拉

`@dnd-kit` 同一套 API 支援三種拖拉：卡片跨欄移動、卡片同欄重排、欄位本身重排。

**不使用** `react-beautiful-dnd`（Atlassian 已 archive，React 18 StrictMode 下行為有問題），**不使用** HTML5 native drag（Electron on macOS 的 drop 判定與游標回饋品質差）。

**拖拉不會中斷終端機**：xterm 實例住在 `TerminalHost`，`CardItem` 僅是元資料的視覺呈現。拖拉只改 `board.json` 的陣列，pty 完全無感。這是把 xterm 抽離卡片的直接紅利。

### 尺寸同步

分隔線拖曳、視窗 resize、切換卡片這三個時機，都須對 active terminal 呼叫 `fitAddon.fit()`，再將算出的 `cols/rows` 經 IPC 傳給 main 執行 `pty.resize()`。

拖曳分隔線時須 **debounce 100ms**，否則會對 pty 狂發 resize，TUI 會瘋狂重繪。此處若未正確實作，Claude Code 的介面會排版錯亂。

### 新增卡片表單

欄位：標題、cwd、command（預設填 `claude`）。cwd 以 Electron `dialog.showOpenDialog` 選擇目錄，不要求手動輸入路徑。

### 快捷鍵

MVP 只納入 **⌘K 快速跳轉卡片**（模糊搜尋標題／專案名）。卡片數量多時，⌘K 打兩個字跳過去比用滑鼠掃視快得多，直接命中核心痛點。其餘快捷鍵待實際使用習慣成形後再加。

### 視覺方向

深色但有層次，非純黑貼純白：底 `#0d1117` → 欄位 `#161b22` → 卡片 `#1c2128`，以明度分層建立結構感。

- **欄位色帶**：欄頭上方 3px 色條，顏色可設定。這是看板辨識度的主要來源，掃視時靠顏色定位比讀文字快
- **卡片**：圓角 8px、1px subtle border，hover 時 border 提亮並上浮 2px
- **狀態燈**：running 用**呼吸**動畫（緩慢明暗，2s 週期），不用閃爍 — 閃爍在餘光中很干擾，多張卡片同時閃爍尤其煩躁；idle 靜態黃、stopped 灰
- **拖拉回饋**：被拖的卡片傾斜 3° 並加陰影抬起，原位置留虛線 placeholder
- **字體**：UI 用 SF Pro，終端機用 SF Mono
- **動畫**：過場動畫（hover、拖拉、切換卡片）一律 ≤150ms，有回饋但不拖沓；狀態燈的呼吸動畫屬持續性指示，不受此限

密度上讓一欄能舒服容納 8–10 張卡，靠壓縮卡片內距與行高達成，而非取消留白 — 卡片之間仍保留 8px 間隙，不擠成一塊。

## 6. 測試策略

GUI 加子程序的應用，E2E 投報率低。策略是**測純邏輯，UI 手動驗證**。以 Vitest 執行。

| 目標 | 測試內容 |
|---|---|
| `board` reducer | 卡片跨欄移動、同欄重排、欄位重排、刪卡片連帶 kill、拖到空欄、拖回原位 |
| `git.ts` | 一般 repo、worktree（`.git` 為檔案）、detached HEAD、非 repo 目錄 |
| `board-store` | JSON 損毀容錯、debounce 寫入、版本欄位驗證 |
| `pty-manager` | 以 fake pty 測 spawn / kill / exit 事件與 Map 清理 |

上述皆為純函式或可注入依賴的模組，適合 TDD。

## 7. 分發

**打包**：`electron-builder` **分別產出 arm64 與 x64 兩個 `.dmg`**。

原本規劃的是單一 universal binary，實作時證實不可行：`node-pty` 的跨架構 prebuild 在 lipo 合併階段衝突。這是 native module 的已知限制，不是設定錯誤（build log 中沒有 Node 版本相關的 EBADENGINE 錯誤）。兩包功能完全相同，代價僅是分發時接收者要選對架構，README 已說明。強求 universal 需自行編譯 `node-pty` 或等上游修復，成本遠高於收益。

`node-pty` 為 native addon，以 `asarUnpack` 解壓在 asar 之外，接收者無需安裝 Xcode Command Line Tools。

**Gatekeeper**：未經 Apple 簽名的 app，首次開啟會被擋下並顯示「無法驗證開發者」。README 須寫明解法：

```bash
xattr -dr com.apple.quarantine /Applications/SharkCommand.app
```

執行一次即可。若日後需散佈給非工程師，再考慮 Apple Developer Program（$99/年）的簽名與公證，屆時下載即可開啟。

**GitHub Actions 自動 release 不納入 MVP**，先以 `npm run build:mac` 手動出包。

## 8. MVP 範圍

### 納入

- 看板 CRUD（欄位、卡片的新增／編輯／刪除）
- 三種拖拉（卡片跨欄、卡片同欄重排、欄位重排）
- 內嵌終端機與完整 pty 生命週期
- 狀態燈（running / idle / stopped）
- git branch 顯示
- ⌘K 快速跳轉
- `board.json` 持久化與損毀容錯
- electron-builder 打包 `.dmg`（arm64 與 x64 各一包）

### 明確排除至 v2

| 項目 | 排除理由 |
|---|---|
| session 保活 | 關閉 app 即 kill 所有 pty。保活需背景 daemon 或 tmux backing，架構複雜度大幅上升 |
| `claude --resume` 整合 | 需解析 `~/.claude/projects/` 的 session 記錄取得 session id，實作與維護成本高 |
| 「等你回答」語意偵測 | 需對輸出做 pattern match，Claude Code 版本一改就失準 |
| session 完成的 macOS 通知 | 依賴上述語意偵測才能可靠判斷「做完了」，兩者須一併實作才有意義 |
| 單卡多終端機分頁 | MVP 維持卡片與 session 一對一 |
| 亮色主題 | 自用工具，深色一套即可；補上等於整套 token 要維護兩份 |
| GitHub Actions 自動 release | 手動出包已足夠 |
