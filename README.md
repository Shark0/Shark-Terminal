# Shark Terminal

以 Trello 式看板管理多個 Claude Code session 的 macOS 應用。欄位代表工作階段，卡片代表一個內嵌終端機 session，拖拉卡片即可推進階段。

## 為什麼做這個

同時跑十幾個 Claude Code session 時，終端機的分頁是一維水平排開的：看不出哪個在哪個階段，也分不清哪個分頁在做什麼。Shark Terminal 用二維看板取代那條 tab bar。

## 功能

- 首次啟動是空白看板，自行建立需要的工作階段欄位
- 卡片可跨欄拖拉、同欄重排；欄位本身也可拖拉調整順序
- 每張卡片是一個內嵌終端機，記住工作目錄與啟動指令
- 狀態燈一眼看出執行中 / 閒置 / 已停止
- 卡片顯示所在 git branch（支援 worktree）
- ⌘K 模糊搜尋快速跳轉

## 下載安裝

到 [Releases](https://github.com/Shark0/Shark-Terminal/releases/latest) 下載。因為 `node-pty` 這個 native addon 無法做成 universal binary，arm64 與 x64 分開發佈，功能完全相同 —— 請依你的機型擇一：

| 機型 | 下載 |
| --- | --- |
| **Apple Silicon**（M1 / M2 / M3 / M4 系列） | [`SharkTerminal-0.1.1-arm64.dmg`](https://github.com/Shark0/Shark-Terminal/releases/download/v0.1.1/SharkTerminal-0.1.1-arm64.dmg) |
| **Intel** | [`SharkTerminal-0.1.1-x64.dmg`](https://github.com/Shark0/Shark-Terminal/releases/download/v0.1.1/SharkTerminal-0.1.1-x64.dmg) |

不確定自己是哪種機型，可點左上角  選單 → 關於這台 Mac 確認晶片型號。

1. 掛載 `.dmg`，把 `Shark Terminal.app` 拖進「應用程式」
2. 這個 app 沒有經過 Apple 簽章，第一次開啟會被 Gatekeeper 擋下並顯示「無法驗證開發者」。執行以下指令解除，一次就好：

```bash
xattr -dr com.apple.quarantine "/Applications/Shark Terminal.app"
```

3. 正常開啟

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
npm run build:mac # 打包成 .dmg（arm64 與 x64 各一包）
```

（打包會為 arm64 與 x64 分別重建 node-pty，結束後會自動還原成本機架構；
若中途中斷，手動跑 `npx electron-builder install-app-deps` 即可修復）

## 資料存放

看板資料存在 `~/.sharkterminal/board.json`，純文字 JSON，可自行編輯或備份。檔案損毀時會自動備份成 `board.json.corrupt-<timestamp>` 並回退成預設看板。

## 已知限制

- 關閉視窗即結束 app（不像多數 macOS app 會留在 Dock），所有終端機 session 也會跟著關掉，session 不會保活
- 狀態燈只反映「有沒有輸出在流動」，不會判斷 Claude 是否正在等你回答
- 沒有 Apple 開發者簽章，首次開啟需手動解除 quarantine（見上方安裝步驟）
