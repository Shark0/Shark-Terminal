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
