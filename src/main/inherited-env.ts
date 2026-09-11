/**
 * 卡片必須是一台乾淨的終端機。這個 app 若不是從 Finder / Dock 啟動，而是從某個 Claude Code
 * session 或 Terminal.app 的 shell 裡跑起來，process.env 會帶著「啟動者是誰」的身分標記，
 * 一路傳進每一張卡片。三類都要洗掉：
 *
 * 1. CLAUDE_*：CLAUDE_CODE_CHILD_SESSION=1 會讓卡片內的 claude 自認是子 session，
 *    既不寫 prompt 歷史（按 ↑ 叫不出上一個指令），也不寫 sessions/<pid>.json
 *    （SessionScanner 讀不到 status，回合結束不會有提示音）。
 *    用前綴排除而非逐項列舉，Claude 之後新增標記才不會靜默漏掉；純設定用途的 CLAUDE_*
 *    （CLAUDE_CODE_USE_BEDROCK 之類）跟著被清掉無妨——那種變數會寫在 rc 檔裡，
 *    卡片開的是 login shell，自己會載回來。
 * 2. TERM_PROGRAM / TERM_SESSION_ID：/etc/zshrc 最後一行是
 *    `. "/etc/zshrc_$TERM_PROGRAM"`，值為 Apple_Terminal 時會載入 macOS 的 per-session
 *    歷史機制，把 HISTFILE 改指到 ~/.zsh_sessions/$TERM_SESSION_ID.historynew。
 *    所有卡片繼承同一個 TERM_SESSION_ID 就共用同一個檔，而 shell 收攤時會把它併進
 *    ~/.zsh_history 再 rm——先關的卡片一關，其他卡片正在寫的歷史就一起消失。
 * 3. GIT_EDITOR / AI_AGENT：Claude Code 為了讓自己跑的工具不卡在互動介面而設的。
 *    GIT_EDITOR=true 留著，卡片裡的 git commit（不帶 -m）會因為訊息是空的直接中止，
 *    git rebase -i 也變成沒有動作。
 */

/** 掃描器要靠它找 session 檔，是唯一該留下的 CLAUDE_* */
const KEPT_CLAUDE_ENV = 'CLAUDE_CONFIG_DIR'

const INHERITED_MARKERS = new Set([
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'TERM_SESSION_ID',
  'GIT_EDITOR',
  'AI_AGENT',
])

/**
 * 回傳洗掉身分標記後的環境副本，不動到來源。
 * 在 main 啟動時算一次，明確傳給卡片的 pty 與探測用的 login shell——
 * 不就地改 process.env，是因為那樣正確性就綁在「洗的那一行要早於每一處讀取」，
 * 而 ESM 會先跑完所有 import，哪天有模組在 top-level 讀 process.env 就靜默失效。
 */
export function withoutInheritedIdentity(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith('CLAUDE') && key !== KEPT_CLAUDE_ENV) continue
    if (INHERITED_MARKERS.has(key)) continue
    env[key] = value
  }
  return env
}
