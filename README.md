# Shark Terminal

以 Trello 式看板管理多個 Claude Code session 的 macOS 應用。欄位代表工作階段，卡片代表一個內嵌終端機 session，拖拉卡片即可推進階段。

## 為什麼做這個

同時跑十幾個 Claude Code session 時，終端機的分頁是一維水平排開的：看不出哪個在哪個階段，也分不清哪個分頁在做什麼。Shark Terminal 用二維看板取代那條 tab bar。

## 功能

- 首次啟動是空白看板，自行建立需要的工作階段欄位
- 卡片可跨欄拖拉、同欄重排；欄位本身也可拖拉調整順序
- 每張卡片是一個內嵌終端機，記住工作目錄，開啟後自動執行 `claude`
- 狀態燈一眼看出執行中 / 閒置 / 已停止
- 卡片顯示所在 git branch（master / main 不顯示）；session 在 repo 內建立 worktree 工作時，改顯示該 worktree 的目錄名
- Claude 完成工作、等你回覆時播放系統提示音（讀取 Claude Code 寫在 `~/.claude/sessions/` 的狀態）
- ⌘K 模糊搜尋快速跳轉

## 下載安裝

到 [Releases](https://github.com/Shark0/Shark-Terminal/releases/latest) 下載。因為 `node-pty` 這個 native addon 無法做成 universal binary，arm64 與 x64 分開發佈，功能完全相同 —— 請依你的機型擇一：

| 機型 | 下載 |
| --- | --- |
| **Apple Silicon**（M1 / M2 / M3 / M4 系列） | [`SharkTerminal-arm64.dmg`](https://github.com/Shark0/Shark-Terminal/releases/latest/download/SharkTerminal-arm64.dmg) |
| **Intel** | [`SharkTerminal-x64.dmg`](https://github.com/Shark0/Shark-Terminal/releases/latest/download/SharkTerminal-x64.dmg) |

上面兩個連結永遠指向最新版，不需要跟著版號改。

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

打包完成後會刪掉 `release/mac`、`release/mac-arm64` 裡解開的 `.app`，只留 `.dmg`，避免 Spotlight／Launchpad 同時列出多個 Shark Terminal。

拖曳卡片的行為牽涉 dnd-kit 的碰撞偵測與真實版面，jsdom 測不到，另有一支在真的 Electron 裡跑的煙霧測試：

```bash
npm run dev:debug   # 終端機 A：dev 模式並開啟 remote debugging port 9333，使用 ~/.sharkterminal/board.dev.json
npm run smoke:drag  # 終端機 B：自動拖曳六種情境（同欄重排、跨欄、縫隙來回、視窗邊緣…），監聽 renderer 錯誤
```

看板需要至少一欄有兩張以上卡片、一個空欄、另一欄有卡片，且都在視窗可見範圍內；Node 20 需要 `--experimental-websocket`（script 已帶）。

## 資料存放

看板資料存在 `~/.sharkterminal/board.json`，純文字 JSON，可自行編輯或備份。檔案損毀時會自動備份成 `board.json.corrupt-<timestamp>` 並回退成預設看板。

## 已知限制

- 關閉視窗即結束 app（不像多數 macOS app 會留在 Dock），所有終端機 session 也會跟著關掉，session 不會保活
- 狀態燈只反映「有沒有輸出在流動」，不會判斷 Claude 是否正在等你回答；提示音依 Claude Code 的 session 狀態檔每 3 秒取樣一次，回合結束後最多 3 秒才響，3 秒內就結束的極短回合可能漏掉
- worktree 偵測靠的是 Claude 跑指令時子程序的工作目錄，session 只用 Read / Edit 而從沒在 worktree 裡跑過指令的話偵測不到；偵測到的 worktree 會記在卡片上，直到目錄被移除或卡片的工作目錄改變才清除
- 0.2 之後建立的卡片不再有舊版的 `command` 欄位，降版回 0.1.x 會把整份看板判為損毀、備份後重置；備份檔還在，手動替每張卡片加回 `"command": "claude"` 即可還原
- 沒有 Apple 開發者簽章，首次開啟需手動解除 quarantine（見上方安裝步驟）
