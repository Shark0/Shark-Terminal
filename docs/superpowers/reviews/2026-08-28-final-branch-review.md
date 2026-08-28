# 追鯊令 — 整分支最終審查報告

審查範圍：`feat/sharkcommand-mvp` 全分支（37 commits，3891 行）
審查角度：跨模組整體，非單一任務範圍
日期：2026-08-27

---

## 一、跨模組問題

### C1 [Critical] 關閉視窗 ≠ 結束 app：所有 pty 成孤兒，終端機畫面全數遺失

**問題描述**
`app.on('window-all-closed')` 保留了 macOS 慣例的 darwin 例外，不 quit；`mainWindow.on('closed')` 只把參照設為 null，沒有任何 pty 清理。但這是一個**單視窗 app**，關掉視窗後沒有任何 UI 存在，`before-quit` 也不會觸發。

**觸發路徑**
```
使用者按視窗左上紅色 ×（而非 ⌘Q）
  → mainWindow.on('closed') → mainWindow = null
  → window-all-closed → darwin 不 quit，app 續存
  → renderer 程序銷毀 → zustand store、terminal-registry(Map)、pty-activity(Map) 全部消失
  → PtyManager.ptys 的所有 pty 仍存活，claude session 繼續燒 CPU
  → ipc.ts onData 的 `win && !win.isDestroyed()` → win 為 null → 所有輸出靜默丟棄
  → 使用者從 Dock 重新開啟 → app.on('activate') → createWindow()
  → 新 renderer：board 從磁碟重載（卡片都在），但 ptyStatus = {}，狀態燈全部「未啟動」
  → 點「啟動」→ PtyManager.spawn 發現 ptys.has(cardId) → SIGKILL 舊的 → 重建
```

**後果**
1. **核心價值直接失效** —— 「切換卡片時終端機畫面完整保留」在此路徑下不只是不保留，是**整批消失且不可恢復**（xterm scrollback 隨 renderer 一起死）
2. 關窗期間所有 claude session 繼續執行，使用者以為已經關掉，實際上背景有 N 個 node 進程在跑
3. 關窗期間 pty 的所有輸出永久丟失（沒有 ring buffer，`getTerminal()` 回 undefined）
4. 重開視窗後 pty 全部變成「main 有、renderer 不知道」的孤兒；重新啟動會 SIGKILL 掉那個已經跑了半天的 claude session

**四份狀態的分歧程度**：`board.json` 一致；zustand store 重置；`PtyManager.ptys` 保留舊值；`terminal-registry` 清空。**這是四份狀態能達到的最大分歧，且是永久性的**（沒有任何 reconcile 路徑）。

**file:line**：`/Users/shark/GroupCommand/src/main/index.ts:44-46`（closed handler）、`/Users/shark/GroupCommand/src/main/index.ts:86-88`（window-all-closed）

**嚴重度：Critical**（日常操作即可觸發，後果不可逆）

**最小修法**（1 行）
```ts
// src/main/index.ts:86
app.on('window-all-closed', () => {
  // 單視窗 app：關窗即結束，走 before-quit 的完整清理（flush board + killAll pty）
  app.quit()
})
```
`app.quit()` 會觸發既有的 `before-quit`，flush 看板並 killAll，路徑已經寫好且有測試。README 的「已知限制」順手補一句「關閉視窗即結束 app」。

---

### C2 [Critical] dev 與 production 共用同一個 `board.json`，且 dev 完全不參與單一實例保護

**問題描述**
`boardFile` 在模組頂層無條件計算為 `~/.sharkterminal/board.json`（`index.ts:13`）。單一實例保護寫成 `if (!isDev && !app.requestSingleInstanceLock())` —— 在 dev 模式下這個條件短路，**`requestSingleInstanceLock()` 根本不會被呼叫**，也就是 dev 實例既不檢查鎖、也不持有鎖。

已知風險清單把這條記成「dev 模式跳過 lock，重新打開兩個實例併發覆寫的窗口」，但實際比記錄的更嚴重：**lock 從一開始就擋不住這個組合**。production 持有鎖只能擋住第二個 production；dev 那份不在鎖的管轄範圍內。

**觸發路徑**
```
使用者開著安裝好的 .app（持有 lock，記憶體中有 10 張卡）
開發者同時 npm run dev（不拿鎖，載入同一個 board.json，記憶體中也是那 10 張）
  → dev 端拖一下卡片 → persist → main debounce 500ms → 寫入 10 張的 dev 快照
  → 期間 prod 使用者新增 5 張卡 → persist → 寫入 15 張
  → dev 端再動一下 → 寫入 dev 記憶體的 10 張 → prod 那 5 張永久消失
  → prod 記憶體仍有 15 張，下次 prod 存檔又寫回去 → 兩份狀態互相震盪
```

**後果**：**真實的資料遺失**。且 `BoardStore` 是「最後寫入者全贏」的整檔覆寫，沒有版本號、沒有 mtime 檢查、沒有檔案監聽，兩個實例之間沒有任何協調機制。而任務簡報明說「使用者可能正在跑安裝好的 app」——**這正是這個專案開發期的日常組合**。

**file:line**：`/Users/shark/GroupCommand/src/main/index.ts:13`、`/Users/shark/GroupCommand/src/main/index.ts:66-68`

**嚴重度：Critical**

**最小修法**（2 行，且不需要重新引入 lock、不影響熱重啟）
```ts
// index.ts：把 isDev 的定義從 66 行上移到 13 行之前
const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)
// dev 用獨立看板檔，避免與正在使用中的正式版互相覆寫
const boardFile = join(homedir(), '.sharkterminal', isDev ? 'board.dev.json' : 'board.json')
```
順帶好處：開發時不會弄髒真實看板，也不用擔心測試資料混進去。

---

### I1 [Important] pty 啟動失敗完全靜默 —— 按「啟動」沒反應、打字沒反應、無任何說明

**問題描述**
`startPty` 的 catch 只做兩件事：`console.error` 與 `setPtyStatus('stopped')`（`app-store.ts:232-234`）。renderer 的 console 在 production 打包後無處可見，狀態燈從灰變灰（`undefined` 與 `stopped` 視覺完全相同）。

**觸發路徑**
```
CardDialog 允許手動輸入 cwd 且完全不驗證目錄是否存在（CardDialog.tsx:70-77）
  → 使用者打錯路徑，或事後把專案目錄搬走／刪掉
  → 按「啟動」→ nodePty.spawn 對不存在的 cwd 拋錯 → ipc rethrow → invoke reject
  → catch → 狀態燈灰、終端機一片黑、沒有任何文字
  → 使用者以為要在終端機裡打字 → ensureTerminal 已建立實例且 TerminalSlot 會 focus 它
  → term.onData → window.gc.pty.write → main 端 warn「找不到對應的 pty」→ 按鍵全部丟棄
  → 使用者完全無從得知發生什麼事
```

**後果**：核心功能（開 session）失敗時零回饋。這是「只有真人點下去才會暴露」的典型，且 cwd 打錯／專案搬家是**必然會發生**的事，不是邊緣情境。

**file:line**：`/Users/shark/GroupCommand/src/renderer/store/app-store.ts:228-235`

**嚴重度：Important**（我傾向視為合併阻擋，理由見 triage）

**最小修法**（3 行，寫在既有的 catch 裡）
```ts
} catch (err) {
  console.error('[app-store] 啟動終端機失敗', { cardId, cwd: card.cwd, err })
  // 錯誤直接寫進該卡片的 xterm——實例已經存在，畫面會保留住訊息，
  // 也順帶解釋了「為什麼在這裡打字沒反應」
  term.write(`\r\n\x1b[31m啟動失敗：${String(err)}\x1b[0m\r\n`)
  get().setPtyStatus(cardId, 'stopped')
}
```
這個修法比「另開一個 error state + UI 元件」小得多，而且訊息會跟著卡片留在畫面上，符合本專案「畫面完整保留」的一致性。

---

### I2 [Important] 存檔失敗與唯讀模式完全靜默；production 沒有任何 log 落地

**問題描述**
這是兩個互相放大的問題。

**(a) 寫入失敗靜默**：`writeAtomic` 的 catch 只 `console.error`（`board-store.ts:165-166`）。`save()` 是 fire-and-forget 的 debounce，`ipcMain.handle('board:save')` 不 await、不回傳錯誤，renderer 的 `void window.gc.board.save(board)` 也沒有 `.catch`。整條鏈路上**沒有任何一個環節能把寫入失敗告訴使用者**。

**(b) 唯讀模式靜默**：`load()` 遇到非 ENOENT 錯誤時設 `readOnly = true` 並回傳空白看板，但 `recoveredFrom` 是 `null`——**與「一切正常」完全同值**（`board-store.ts:106-109`）。使用者看到的是一個空看板，會合理推斷「資料丟了」，於是開始重建；而所有重建的內容都被 `save()` 的 readOnly guard 靜默丟棄。

**(c) 放大因子**：整個專案的錯誤處理策略幾乎全押在 `console.warn/error`（符合 CLAUDE.md 的要求），但**打包後的 `.app` 從 Finder 啟動時，main 程序的 stdout 沒有任何人在看，也沒有寫進任何 log 檔**。renderer 的 console 轉印只在 dev 模式生效（`index.ts:53-58` 的 `ELECTRON_RENDERER_URL` guard）。使用者回報「怪怪的」時，維護者手上什麼證據都沒有。

**觸發路徑**：磁碟滿、`~/.sharkterminal` 權限異常、檔案被外部程式鎖住、使用者手動建了同名目錄（EISDIR）。

**後果**：使用者整天的編輯靜默遺失且無感知；或看到空看板誤以為資料全毀。

**file:line**：`/Users/shark/GroupCommand/src/main/board-store.ts:165-176`、`/Users/shark/GroupCommand/src/main/board-store.ts:100-109`、`/Users/shark/GroupCommand/src/main/ipc.ts:26-28`

**嚴重度：Important**

**最小修法**
- (b) 是最便宜也最該先做的：`BoardLoadResult` 加一個 `readOnly: boolean`（型別載體已經在 `types.ts:53-58`），`RecoveryNotice` 加一個紅色分支顯示「無法讀取看板檔，目前為唯讀，所有變更都不會被儲存」。約 15 行。
- (a) 沿用既有的 `webContents.send` 廣播機制（`pty:data` 已經是這個模式）送一個 `board:save-failed`，renderer 用同一個橫幅顯示。約 20 行。
- (c) 一個把 `console.warn/error` 同時 append 到 `~/.sharkterminal/logs/main.log` 的 20 行 wrapper，或直接引入 `electron-log`。不阻擋合併，但這是接手維護的最大盲點（見第三節）。

---

### I3 [Important] 切換卡片後鍵盤焦點可能停在非終端機元素 —— 打字完全沒反應

**問題描述**
唯一會把焦點交給終端機的地方，是 `TerminalSlot` 的 `useEffect(..., [active, cardId])`（`TerminalHost.tsx:22-27`）。這個 effect 只在 `active` **變化**時才跑。

**觸發路徑（三條，都是日常操作）**
1. 點擊一張**已經是 active** 的卡片 → 焦點跑到 `CardItem` 的 `div`（`tabIndex=0`）→ `active` 沒變 → effect 不跑 → 焦點卡在卡片上 → 打字進黑洞
2. ⌘K 開面板 → 選中**目前已經 active** 的那張 → `setActiveCard` 同值 → effect 不跑 → 焦點停在剛卸載的 input → 落回 `document.body` → 打字進黑洞
3. CardDialog 關閉後（儲存或取消）焦點同樣沒有交還

**後果**：使用者必須用滑鼠額外點一下終端機才能打字。以「用鍵盤驅動 Claude Code」為核心的工具來說，這很傷。而且症狀是「有時候能打有時候不能打」，使用者不會知道規則。

**file:line**：`/Users/shark/GroupCommand/src/renderer/board/Column.tsx:59`、`/Users/shark/GroupCommand/src/renderer/CommandPalette.tsx:54-57`、`/Users/shark/GroupCommand/src/renderer/terminal/TerminalHost.tsx:22-27`

**嚴重度：Important**（體驗層，不影響資料）

**最小修法**（兩個一行）
```ts
// Column.tsx:59
onSelect={() => { setActiveCard(cardId); getTerminal(cardId)?.term.focus() }}

// CommandPalette.tsx:54
const choose = (cardId: string): void => {
  setActiveCard(cardId)
  getTerminal(cardId)?.term.focus()
  onClose()
}
```
（切到不同卡片時這行會先跑一次、effect 再跑一次，兩次 focus 同一個 term，無害；隱藏用的是 `opacity-0` 而非 `display:none`，元素在 DOM 中可被 focus。）

---

### I4 [Important] 單卡 kill 直送 SIGKILL 給 shell，孤兒 claude 進程風險未經實測

**問題描述**
我確認過 `node-pty` 的實作：`UnixTerminal.prototype.kill = signal => process.kill(this.pid, signal)`（`node_modules/node-pty/lib/unixTerminal.js:226-231`）——**只殺 pty 的直接子行程（zsh），不是 process group**。

`PtyManager.kill()`（刪卡片、按停止、刪欄位、重啟時的取代）直送 `SIGKILL`（`pty-manager.ts:101`）。zsh 被 SIGKILL 時**不會**送 SIGHUP 給它的 job，claude 會失去 parent。理論上 pty master 隨後關閉會讓 kernel 對 slave 的 foreground process group 送 SIGHUP，claude 應該會死——但這條鏈路依賴 node-pty 的 socket close → `_close()` → fd 釋放的時序，**沒有任何人實測過**。

Task 9 的 deferred 自承第 10 項「⌘Q 是否乾淨結束所有 pty」未驗證，Task 5 的 deferred 把 SIGKILL 記為設計選擇但沒有驗證後果。

**後果**：若鏈路沒接上，使用者每刪一張執行中的卡片就留一個孤兒 claude（node 進程，記憶體數百 MB）。使用者不會發現，直到電腦變慢。

**注意**：`killAll()`（app 關閉路徑）是先 SIGTERM 再 SIGKILL，相對安全；有問題的只有單卡路徑。

**file:line**：`/Users/shark/GroupCommand/src/main/pty-manager.ts:92-106`

**嚴重度：Important**

**最小處置**：這條我建議**先驗證再決定要不要改**（見第二節）。驗證方式：
```bash
ps aux | grep -c '[c]laude'          # 記下基準
# 開 3 張卡啟動 → 確認 claude 進程數 +3 → 刪掉 3 張卡 → 等 5 秒
ps aux | grep -c '[c]laude'          # 應回到基準
# 再開 3 張 → ⌘Q → 再測一次
```
若有殘留，修法是把單卡 kill 改成「SIGTERM + 逾時後 SIGKILL」。注意**不能**照抄 `killAll` 的寫法：`spawn()` 的重啟路徑會在 kill 之後立刻 `ptys.set(cardId, newPty)`，用 `ptys.get(cardId) !== pty` 判斷會誤判成「已被取代」而永遠不補 SIGKILL。需要在 `onExit` 裡標一個 `exited` flag 給 timeout 判斷。

---

### 生命週期鏈路檢查表

| 階段 | main pty | renderer xterm | ptyStatus | lastOutputAt | board.json | 結論 |
|---|---|---|---|---|---|---|
| 建卡片 | — | — | — | — | ✅ persist | OK |
| 啟動 pty | ✅ Map.set | ✅ ensureTerminal | ✅ set | — | — | OK |
| 切換卡片 | 不動 | 不動 | 不動 | 不動 | 不動 | ✅ 核心價值成立 |
| 拖拉卡片 | 不動 | 不動 | 不動 | 不動 | ✅ commitBoard | ✅ pty 完全無感 |
| 停止 pty | ✅ SIGKILL(?I4) | 保留（刻意） | ✅ stopped | ❌ 未 clear | — | 微量洩漏，無實害 |
| 刪卡片 | ✅ kill | ✅ dispose | ✅ delete | ✅ clear | ✅ persist | OK |
| 刪欄位 | ✅ 逐張 kill | ✅ 逐張 dispose | ✅ 批次 delete | ✅ clear | ✅ persist | OK |
| **關視窗** | ❌ **完全不清** | ❌ 整批遺失 | ❌ 重置 | ❌ 重置 | 一致 | **C1** |
| ⌘Q | ✅ killAll | 隨程序結束 | — | — | ✅ flush | OK |

只有「關視窗」這一格是破的，但它破得很徹底。

### 錯誤傳播檢查表

| 失敗點 | 到達使用者？ | 有 log？ | production 看得到 log？ |
|---|---|---|---|
| `board:load` 拋錯 | ❌ 空白看板無說明 | ✅ console.error | ❌ |
| `load` 進入 readOnly | ❌ 空白看板無說明 | ✅ console.error | ❌ |
| `writeAtomic` 失敗 | ❌ 完全靜默 | ✅ console.error | ❌ |
| `backup()` 失敗 | ⚠️ 與正常同值 | ✅ | ❌ |
| `pty:spawn` 失敗 | ❌ 灰燈+黑畫面 | ✅ console.error | ❌ |
| `pty:write/resize/kill` 失敗 | ❌ 靜默 | ✅ console.warn | ❌ |
| `git:branch` 失敗 | ⚠️ 標籤消失 | ✅ console.warn | ❌ |
| `pickDirectory` 失敗 | ❌ 按了沒反應 | ✅ console.warn | ❌ |
| board.json 損毀 | ✅ **RecoveryNotice** | ✅ | ❌ |

**九條失敗路徑，只有一條會告訴使用者。** 且 log 在 production 一律看不到。

### 並發檢查（結論：比預期紮實）

我逐條追過所有 IPC 競態，結論是**大部分已被既有 guard 蓋掉**：

- **Electron 保證同一 renderer 的 `invoke` 與 `send` 依序送達 main**，所以 Task 9 deferred 擔心的「kill 先於 spawn 到達 main、留下 renderer 不知情的 OS 行程」不會發生
- `setPtyStatus` 的 `if (!state.board.cards[cardId]) return state`（`app-store.ts:180-186`）一個人擋掉了三條路徑：刪卡後延遲的 `pty:exit`、刪卡後 spawn resolve 的 `'running'`、刪卡後 spawn reject 的 `'stopped'`
- 「啟動後立刻停止」的 status 錯亂會被隨後的 `pty:exit` 自我修正
- 快速連按「啟動」由 `spawn()` 的身分比對正確處理（`pty-manager.ts:59-65`），有測試鎖住
- `loadBoard` 的 in-flight promise 去重擋住 StrictMode 雙重 mount
- 拖拉期間沒有其他 board 寫入者，snapshot/restore 語意乾淨

**唯一真正的並發缺口是 C2（跨程序），不是 IPC 層。** 這點值得肯定——IPC 層的併發處理品質明顯高於平均。

### 其他 Minor

| # | 問題 | file:line |
|---|---|---|
| M1 | `note` 可編輯但**任何地方都不顯示**，連 tooltip 都沒有；寫進去就再也看不到（除非重開編輯 dialog）。修法：`CardItem` 外層 div 加 `title={card.note \|\| undefined}`，一行 | `src/renderer/board/CardItem.tsx:47` |
| M2 | CommandPalette 的 Escape 只 `preventDefault` 未 `stopPropagation`，與 CardDialog 同時開啟時 Escape 會一次關掉兩個 | `src/renderer/CommandPalette.tsx:96-98` |
| M3 | README 說「預設：需求評估中/開發中/Review中/等待Merge」，實作是**完全空白看板**；README 又說 board.json「可自行編輯」，但 app 執行中沒有檔案監聽且下次 persist 會覆蓋 | `README.md:11`、`README.md:56` |
| M4 | 刪除欄位的 × 是 `opacity-0` 而非 `pointer-events-none`，看不見但可點（有 confirm 擋著，不會誤刪） | `src/renderer/board/ColumnHeader.tsx:74-76` |
| M5 | 死碼：`hasTerminal`、`PtyManager.has()`（僅測試使用）、`.no-drag` CSS、`Column` 的 `flex-1/overflow-y-auto`（`items-start` 之下無效）、`pty.kill` 的 try/catch（node-pty 內部已 swallow 所有例外） | 多處 |
| M6 | `before-quit` 的清理無外層 timeout，且「清理中一律 preventDefault」；若 fs 掛住，app 永遠退不掉且連按 ⌘Q 無效，使用者只會覺得當機。加一個 `Promise.race` 3 秒 timeout 即可 | `src/main/index.ts:92-113` |
| M7 | `process.env.SHELL ?? '/bin/zsh'` 的 fallback 沒有 log（CLAUDE.md 要求 fallback 分支要記錄）；production 從 Finder 啟動時 `SHELL` 可能不存在，使用 fish/bash 的人會靜默拿到 zsh | `src/main/pty-manager.ts:38` |
| M8 | 切到「從未啟動過」的卡片時，`TerminalHost` 沒有對應 slot，顯示純黑區塊，沒有任何「按上方啟動」的引導 | `src/renderer/terminal/TerminalHost.tsx:47` |
| M9 | ⌘K 在 CardDialog 開啟時仍生效，面板會疊在 dialog 上 | `src/renderer/App.tsx:71-77` |

---

## 二、Deferred triage（53 條）

### 必須修（合併前）

以下 4 條全部來自第一節，**沒有一條原本在 deferred 清單裡**——這正說明單一任務範圍的審查看不到它們。

| # | 項目 | 後果 | 最小修法 |
|---|---|---|---|
| **1** | **C1 關窗不清理 pty** | 核心功能失效 + 孤兒進程 + 畫面永久遺失 | `window-all-closed` 移除 darwin 例外（1 行） |
| **2** | **C2 dev/prod 共用 board.json** | 真實資料遺失，且是開發期日常 | dev 改用 `board.dev.json`（2 行） |
| **3** | **I1 spawn 失敗靜默** | 核心功能失敗零回饋，cwd 打錯必然發生 | catch 裡往 xterm 寫紅字（3 行） |
| **4** | **I2(b) readOnly 模式無提示** | 使用者看到空看板誤以為資料全毀，重建內容全被丟棄 | `BoardLoadResult` 加 `readOnly`，`RecoveryNotice` 加紅色分支（~15 行） |

**外加 1 條必須「驗證」（不一定要改）**

| # | 項目 | 驗證方式 |
|---|---|---|
| **5** | **I4 SIGKILL 是否留下孤兒 claude** | `ps aux \| grep '[c]laude'` 前後對照：開 3 張卡 → 刪 3 張卡 → 等 5 秒 → 數量須回到基準；再測一次 ⌘Q 路徑。若有殘留則升級為必須修 |

原 deferred 清單中，我判定**沒有任何一條達到「必須修」門檻**。理由：

- Task 9 的兩條競態（`startPty/stopPty` 與 main 端）經追查後確認被 IPC 順序保證 + `setPtyStatus` 的存在性 guard 蓋住，最終狀態一律正確 → 降級為「可以留著」
- Task 6 的 killAll SIGKILL 分支「先 delete 再送信號」確認無實害（`app.exit()` 緊接其後，無接收者）→ 「可以留著」
- Task 6 的「端到端探針位於 App.tsx 且無 DEV 保護」→ **已確認移除**（現行 `App.tsx` 乾淨）

### 建議修（不阻擋合併，但會影響體驗或維護）

**高優先（我會在合併後第一批處理）**

| 來源 | 項目 | 理由 |
|---|---|---|
| 新發現 I3 | 切換卡片後焦點未交給終端機 | 兩個一行的修法，換來鍵盤驅動體驗完整。價值/成本比最高的一條 |
| 新發現 I2(a)(c) | 寫入失敗廣播 + production log 落地 | 沒有 log 就沒有 debug 能力（見第三節） |
| Task 11 | app icon 未設定 | 打包分發給朋友時是第一印象；Dock 上一排 Electron 預設 icon 很難認 |
| Task 10 | `branches` 為完整替換而非 merge | 單次讀取失敗會讓 branch 標籤閃爍，改 merge 是 3 行 |
| 新發現 M3 | README 與實作不符（預設欄位、board.json 可編輯） | 一行改，但錯誤文件比沒文件糟 |
| 新發現 M1 | note 完全不可見 | `title={card.note}` 一行，讓已存在的功能真的能用 |
| 已知風險 2 | 欄位高度自適應只驗證 4 次 | 需補「高度落差大的跨欄拖曳」與「已捲動時開始拖曳」兩個人工驗證。dnd-kit 在巢狀捲動容器下是已知痛點 |

**中優先（維護性）**

| 來源 | 項目 |
|---|---|
| Task 7、Task 7 | 測試檔的 triple-slash reference 收進 `vitest.setupFiles`（兩條 deferred 講同一件事） |
| Task 10 | app-store 測試的 gc mock 缺 `git.branch`；`refreshPtyStatuses`/`loadBranches` 無單元測試 |
| Task 5 | `killAll` 的連帶路徑補一個「restart 後緊接 killAll」的端到端測試 |
| Task 6 | `ipc.ts` 四處 try/catch 無測試，rethrow 行為靠人工讀碼 |
| Task 4 | `reconcile` 缺「失效引用+孤兒卡片同時發生」測試；`isValidBoard` 的 it.each 未涵蓋 card 欄位缺漏 |
| Task 5 | `onData`/`onExit` 單一 callback 重複訂閱會靜默覆蓋——加一行 warn 即可，不必抽象 |
| Task 1 | `package.json` 缺 `engines.node`（README 已寫「需要 Node 20 以上」，補上讓它可強制） |
| Task 6 | `before-quit` 無外層 timeout（M6） |
| Task 11 | `CommandPalette` 的 ArrowDown 未用 `clampCursor`，兩處各自維護 clamp |
| Task 7 | 編輯/改名只綁 `onDoubleClick`，純鍵盤使用者無法觸發 |
| 新發現 M2 | Escape 同時關掉 palette 與 dialog |
| 新發現 M8 | 未啟動卡片的終端機區缺引導文字 |
| 新發現 M7 | `SHELL` fallback 缺 log |

**低優先**

| 來源 | 項目 |
|---|---|
| Task 4 | `writeAtomic` 的 tmp 檔名競態（**已修**：現行版本帶 pid + tmpSeq，這條 deferred 已過期） |
| Task 3 | `resolveGitDir` 不驗證解析路徑存在（行為正確但屬巧合式正確） |
| Task 8 | `onDragOver` 對「同欄索引未變」無 early return |
| Task 11 | 死碼清理（M5 那批） |
| Task 9 | `Splitter` 拖曳時 `setRatio` 觸發子樹重繪 |
| Task 7 | 提示文字與 `placeholder="claude"` 並存的 UX 細節 |

### 可以留著

| 來源 | 項目 | 判定理由 |
|---|---|---|
| Task 1 | tailwind 未含欄位色盤 token | 已裁決為正確設計 |
| Task 1 | `@types/node` 未 pin | 只影響型別，`skipLibCheck` 已開 |
| Task 2 | 報告內部計數誤植 | 文件內部瑕疵 |
| Task 3 | 測試依賴 `os.tmpdir()` 不在 git repo 下 | 目前無 CI |
| Task 4 | `backup()` 失敗回傳 null 與正常同值 | 註解已載明取捨；真正該修的是 readOnly 那條（已列必須修） |
| Task 4 ×2 | 測試 1/2 的斷言寬鬆 | 測試品質，非產品缺陷 |
| Task 5 | `killAll` 未斷言 `has()` 為 false | `has()` 本身就是死碼 |
| Task 5 | 單卡 kill 直送 SIGKILL | 設計選擇，但**孤兒驗證是必須做的**（見必須修 #5） |
| Task 5 | 4 個測試只斷言 warn 被呼叫 | 測試品質 |
| Task 6 | GUI 手動互動未執行 | 已由使用者實機補上 |
| Task 6 | ipc 層未對 `board:load` 併發去重 | app-store 已在 renderer 端去重，足夠 |
| Task 6 | 驗證版 `App.tsx` 的 `.then` 未接 `.catch` | 已被 Task 7 整份替換 |
| Task 6 | 探針無 DEV 保護 | **已確認移除** |
| Task 6 | `tmpSeq` 為模組層級變數 | 實際是 instance 欄位（`board-store.ts:79`），這條 deferred 記錯了 |
| Task 6 | killAll 的 SIGKILL 分支不廣播 exit | 確認無實害 |
| Task 7 | CardDialog 遮罩用內建 `bg-black/60` | 慣例色 |
| Task 7 | ColumnHeader 的 commit 可能呼叫兩次 | idempotent + debounce 合併 |
| Task 8 | `onDragEnd` 的 guard 無 warn | 與既有防禦式風格一致 |
| Task 9 ×2 | `startPty/stopPty` 競態（renderer + main） | **經追查確認被既有 guard 完全蓋住**（詳見第一節並發檢查） |
| Task 9 | `startPty` 讀 `term.cols/rows` 時取到 80×24 | 隨後由 mount effect 的 fit 修正 |
| Task 9 | xterm theme 寫死 hex | 函式庫 API 限制 |
| Task 9 | 無 DOM 環境下 `fit()` 為 no-op | vitest node 環境的必然 |
| Task 10 | `loading` closure 靠隱性不變量 | 測試內部細節 |
| Task 11 | 未實機安裝啟動 | **已由使用者實機完成** |
| Task 11 | Step 10 checklist 第 5 項未重驗 | 併入「已知風險 2」的人工驗證 |
| Task 11 | `build:mac` 用 `&&` 串接 | README 有手動修復指令 |
| Task 11 | `.no-drag` 無元素使用 | 死碼，隨 M5 一起清 |
| 已知風險 3 | killAll SIGKILL 分支不廣播 | 同 Task 6 |

**Triage 統計**：53 條 deferred 中 0 條必須修、19 條建議修、34 條可以留著。必須修的 4 條全部是這次整體審查新發現的跨模組問題。

---

## 三、接手維護最擔心的三件事

### 1. Production 沒有任何可觀測性——出事時手上什麼都沒有

專案的錯誤處理策略是「每個 catch 都 `console.warn/error` 並降級繼續」。這個策略本身是對的，執行也很徹底（我數了 30+ 處，幾乎沒有裸 catch）。但**這些 log 在打包後的 `.app` 裡全部流向 /dev/null**：

- main 從 Finder 啟動時 stdout 沒有終端機接收
- renderer 的 console 轉印被 `ELECTRON_RENDERER_URL` guard 鎖在 dev 模式
- 沒有 log 檔、沒有 crash reporter、沒有任何持久化

結果是：九條失敗路徑中八條對使用者靜默、對維護者也靜默。使用者說「今天看板變空了」，我要怎麼判斷是 `board.json` 損毀（會有 RecoveryNotice）、readOnly 模式（無提示）、還是 dev 實例覆寫（C2）？**三種原因，同一個症狀，零證據。**

這件事本身的修法很便宜（20 行的 log wrapper），但它讓上面所有「靜默失敗」的問題從「可診斷的缺陷」變成「無法診斷的玄學」，是**風險放大器**而不只是一個缺陷。

### 2. 四份記憶體狀態的一致性靠散落各處的 guard 撐著，沒有集中的不變量

`board.json` / zustand / `PtyManager.ptys` / `terminal-registry` 這四份狀態之間**沒有任何 reconcile 機制**（`PtyManager.has()` 存在但沒人呼叫）。一致性完全靠「每個寫入點都記得做對的事」：

- `setPtyStatus` 的存在性 guard（`app-store.ts:180-186`）一個人擋掉三條競態
- `spawn` 的 pty 身分比對（`pty-manager.ts:61`）擋掉重啟時的誤刪誤報
- `deleteCard`/`deleteColumn` 各自手動清四個地方（pty、xterm、activity、ptyStatus），順序還不能錯
- `kill()` 刻意不從 Map 移除，把清理權交給 `onExit`——這個約定只寫在註解裡

這些 guard 每一個都寫得對，也都有測試。但它們是**分散的隱性契約**：`setPtyStatus` 的那三行如果被未來的重構「順手簡化」掉，同時打開三個洞，而且每個洞的症狀都不一樣（狀態燈復活、幽靈 xterm、延遲 exit 誤報）。C1 就是這個模式的實證——四份狀態同時分歧，因為沒有任何一層在檢查「main 認為存在的 pty，renderer 還知道嗎」。

我接手的話會想加一條 `pty:reconcile` IPC（renderer 啟動時問 main「你手上有哪些 cardId」）當作安全網。但 MVP 不做這個是可以接受的取捨——重點是**要知道自己在靠什麼撐**。

### 3. 這個專案的驗證方式與它的失效模式錯位

131 個測試、typecheck 乾淨、11 輪任務審查——但攔下 1 個 Critical + 17 個 Important 之後，使用者**實機點五分鐘又找出 6 個新 bug**，而且是 `window.prompt` 被禁用、缺 drag region 這種「一開啟就撞到」的等級。這次整體審查再找出 2 個 Critical，也都不在任何測試能碰到的層次。

原因是明確的：**測試策略（spec 第 6 節）刻意只測純函式**，這個選擇對 MVP 是對的。但代價是**所有缺陷都集中在未被測試的那一層**：Electron 生命週期（C1）、跨程序（C2）、錯誤路徑的 UI 表現（I1、I2）、焦點管理（I3）、原生 API 行為（`prompt`、`titleBarStyle`）。

這不是「測試不夠多」的問題——再多 100 個純函式測試也抓不到 C1。而是**這個專案的 bug 天生住在測試照不到的地方，唯一有效的驗證手段是真人操作**。接手維護時，如果沿用「加測試就有信心」的直覺，會持續在錯的地方投資。每次改動 main 程序或生命週期，都需要一份人工 checklist，而目前這份 checklist 是散落在 11 份 task report 的 ⚠️ 清單裡、且累積了至少 20 項從未執行的驗證。

---

## 整體評估

**是否適合合併：有條件**

**條件（4 修 + 1 驗，估計 40 行程式碼 + 10 分鐘實測）**

1. `window-all-closed` 移除 darwin 例外（C1，1 行）
2. dev 模式改用 `board.dev.json`（C2，2 行）
3. `startPty` 的 catch 往 xterm 寫錯誤訊息（I1，3 行）
4. `BoardLoadResult` 加 `readOnly` + `RecoveryNotice` 紅色分支（I2b，~15 行）
5. **實測**孤兒 claude 進程（I4）：刪卡片路徑與 ⌘Q 路徑各驗一次，用 `ps` 前後對照；若有殘留則追加修正

**理由**

先說值得肯定的部分，因為這影響我對「有條件」而非「否」的判斷：

**這份實作的品質明顯高於平均。** 併發處理是我最意外的部分——我逐條追過所有 IPC 競態，包括 deferred 清單裡自承有問題的兩條，結果發現它們都已經被既有 guard 完整蓋住，而且蓋得有道理（不是碰巧）。`setPtyStatus` 的存在性檢查、`spawn` 的 pty 身分比對、`loadBoard` 的 in-flight 去重，這三處都是「知道自己在防什麼」才寫得出來的程式碼，而且都有對應的迴歸測試。錯誤處理的覆蓋率也很高——30+ 個 catch 幾乎沒有裸的。註解品質尤其好：幾乎每個非顯然的決策都寫了「為什麼不用另一種寫法」，這對接手的人價值極高。核心價值（切換卡片畫面保留）的架構是對的，xterm 抽離 React 樹住在 module-level Map，拖拉完全不影響 pty，這條主線很乾淨。

再說為什麼不能無條件合併：

**C1 和 C2 都會讓使用者實際損失東西，而且觸發條件是日常操作**，不是邊緣情境。C1 只要按了紅色 × 就會發生——這是 macOS 使用者的肌肉記憶，而後果是整批 claude session 變孤兒、終端機畫面全部遺失，也就是這個 app 存在的唯一理由當場失效。C2 更直接：任務簡報自己說「使用者可能正在跑安裝好的 app」，而這個專案還要繼續開發，兩者同時執行就是資料遺失，沒有任何保護。這兩條的修法都是一到兩行，成本與後果完全不成比例。

**I1 我也放進條件裡，理由是「cwd 打錯或專案搬家」不是假設。** CardDialog 允許自由輸入路徑且零驗證，這條路徑遲早會走到，而走到之後使用者得到的是：灰燈、黑畫面、打字沒反應、零訊息。這與使用者已經找出的那 6 個 bug（儲存按鈕 disabled 卻不說原因、拖曳靜默失效）是同一類——**這個專案反覆在「失敗時不說話」上出問題**，而它們每一個單獨看都很小，加起來構成一種「這個 app 有時候就是不理你」的體驗。

**I2b 是唯一一條我從 deferred 精神裡升級上來的。** 原本的取捨（backup 失敗與正常同值）我同意可以留，但 readOnly 模式不同：使用者會看到一個**空的看板**，理性反應是「資料丟了，我重建吧」，然後重建的東西又全部被靜默丟棄。這是唯一一條會讓使用者主動做出錯誤決策的路徑。型別載體（`BoardLoadResult`）和 UI 元件（`RecoveryNotice`）都已經在那裡，接上去是十幾行的事。

**53 條 deferred 我判定 0 條必須修**，這個結果本身值得說一句：前面 11 輪的 triage 判斷是準的，deferred 進去的東西確實都是 deferred 等級。這次新增的 4 條必須修全部來自跨模組視角——它們不是任何單一任務的疏失，而是**沒有任何一個任務的範圍涵蓋到「app 的整個生命週期」**。這也印證了簡報裡的那句話：問題源自計畫的切分方式，而非實作。

最後，關於接手風險：我最擔心的不是任何一個具體 bug，而是**這個專案的驗證方式與它的失效模式錯位**。131 個測試全部在純函式層，而所有 Critical 都住在 Electron 生命週期、跨程序、錯誤路徑 UI 這三個測試照不到的地方。修完這 4 條之後專案可以合併，但接手的人必須知道：在這裡「測試綠了」和「能用」之間的距離，比一般專案遠得多。
