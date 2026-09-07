import { describe, expect, it, vi } from 'vitest'
import {
  type ClaudeSession,
  type PtyEntry,
  type ScanDeps,
  SessionScanner,
  descendantsOf,
  findWorktreeRoot,
  parseEtime,
  parseLsofCwd,
  parsePs,
} from '../../src/main/session-scan'

const START = 'Wed Sep  2 01:42:20 2026'

/** 組一行 `ps -axo pid=,ppid=,etime=,lstart=` 的輸出 */
function psLine(pid: number, ppid: number, etime = '00:10', start = START): string {
  return `${String(pid).padStart(5)} ${String(ppid).padStart(5)} ${etime.padStart(11)} ${start}\n`
}

describe('parsePs', () => {
  it('解析 pid、ppid、存活時間與啟動時間，建立 parent → children', () => {
    const table = parsePs(psLine(100, 1, '03-04:02:47') + psLine(101, 100, '00:05') + psLine(102, 100))
    expect(table.children.get(1)).toEqual([100])
    expect(table.children.get(100)).toEqual([101, 102])
    expect(table.info.get(100)).toEqual({ elapsedSec: 3 * 86400 + 4 * 3600 + 2 * 60 + 47, started: 'Wed Sep 2 01:42:20 2026' })
    expect(table.info.get(101)?.elapsedSec).toBe(5)
  })

  it('lstart 的多重空白（單位數日期）正規化成單一空白，才能與 Claude 寫的 procStart 比對', () => {
    const table = parsePs(psLine(100, 1, '00:10', 'Wed Sep  2 01:42:20 2026'))
    expect(table.info.get(100)?.started).toBe('Wed Sep 2 01:42:20 2026')
  })

  it('略過空行與格式不對的行', () => {
    const table = parsePs('\n' + psLine(100, 1) + '這不是數字\n  7  8\n')
    expect(table.children.get(1)).toEqual([100])
    expect(table.children.size).toBe(1)
  })
})

describe('parseEtime', () => {
  it.each([
    ['00:10', 10],
    ['04:02:47', 4 * 3600 + 2 * 60 + 47],
    ['03-04:02:47', 3 * 86400 + 4 * 3600 + 2 * 60 + 47],
  ])('%s → %d 秒', (text, seconds) => {
    expect(parseEtime(text)).toBe(seconds)
  })

  it('無法解析時視為最舊（Infinity），不會被挑成最新的程序', () => {
    expect(parseEtime('??')).toBe(Infinity)
  })
})

describe('descendantsOf', () => {
  it('以 BFS 順序回傳所有子孫，直接子程序排在前面', () => {
    const table = parsePs(psLine(10, 1) + psLine(11, 10) + psLine(12, 10) + psLine(13, 11) + psLine(99, 1))
    expect(descendantsOf(table, 10)).toEqual([11, 12, 13])
  })

  it('沒有子程序時回傳空陣列', () => {
    expect(descendantsOf(parsePs(''), 10)).toEqual([])
  })
})

describe('parseLsofCwd', () => {
  it('把 lsof -Fn 的輸出解析成 pid → cwd', () => {
    const out = 'p100\nfcwd\nn/Users/shark/repo\np101\nfcwd\nn/Users/shark/repo/.worktrees/a\n'
    const cwds = parseLsofCwd(out)
    expect(cwds.get(100)).toBe('/Users/shark/repo')
    expect(cwds.get(101)).toBe('/Users/shark/repo/.worktrees/a')
  })

  it('沒有 p 開頭的行就不會產生對應', () => {
    expect(parseLsofCwd('fcwd\nn/tmp\n').size).toBe(0)
  })
})

describe('findWorktreeRoot', () => {
  const isWorktreeRoot = async (dir: string): Promise<boolean> => dir === '/repo/.worktrees/a'

  it('自 cwd 往上找到第一個 worktree 根目錄', async () => {
    expect(await findWorktreeRoot('/repo/.worktrees/a/src/main', '/repo', isWorktreeRoot)).toBe(
      '/repo/.worktrees/a',
    )
  })

  it('cwd 等於卡片根目錄本身時不算 worktree', async () => {
    expect(await findWorktreeRoot('/repo', '/repo', isWorktreeRoot)).toBeNull()
  })

  it('cwd 不在卡片根目錄底下時忽略', async () => {
    expect(await findWorktreeRoot('/elsewhere/.worktrees/a', '/repo', isWorktreeRoot)).toBeNull()
  })

  it('往上找到根目錄都沒有 .git 檔案時回傳 null', async () => {
    expect(await findWorktreeRoot('/repo/src/main', '/repo', isWorktreeRoot)).toBeNull()
  })

  it('不會把 /repo-other 這種前綴相同的路徑誤判成根目錄底下', async () => {
    expect(await findWorktreeRoot('/repo-other/.worktrees/a', '/repo', isWorktreeRoot)).toBeNull()
  })

  it('卡片根目錄是檔案系統根目錄 / 時會終止，不會在 / 無限打轉', async () => {
    const calls: string[] = []
    const probe = async (dir: string): Promise<boolean> => {
      calls.push(dir)
      return false
    }
    expect(await findWorktreeRoot('/a/b', '/', probe)).toBeNull()
    expect(calls).toEqual(['/a/b', '/a'])
  })

  it('卡片根目錄是空字串時直接回 null', async () => {
    expect(await findWorktreeRoot('/a/b', '', isWorktreeRoot)).toBeNull()
  })
})

/** 可逐次調整的假環境：程序表、各程序 cwd、各 pid 的 Claude session 檔、realpath 對應 */
function fakeEnv() {
  const state = {
    ps: '',
    cwds: new Map<number, string>(),
    sessions: new Map<number, ClaudeSession | 'unreadable'>(),
    worktreeRoots: new Set<string>(),
    realpaths: new Map<string, string>(),
  }
  const deps: ScanDeps = {
    ps: async () => state.ps,
    lsofCwd: async (pids) =>
      pids
        .filter((pid) => state.cwds.has(pid))
        .map((pid) => `p${pid}\nfcwd\nn${state.cwds.get(pid)}\n`)
        .join(''),
    readClaudeSession: async (pid) => state.sessions.get(pid) ?? null,
    isWorktreeRoot: async (dir) => state.worktreeRoots.has(dir),
    realpath: async (p) => state.realpaths.get(p) ?? p,
  }
  return { state, deps }
}

function makeScanner(entries: () => PtyEntry[], deps: ScanDeps) {
  const scanner = new SessionScanner(entries, deps)
  const onWorktree = vi.fn()
  const onIdle = vi.fn()
  scanner.onWorktree(onWorktree)
  scanner.onClaudeIdle(onIdle)
  return { scanner, onWorktree, onIdle }
}

const oneCard = (): PtyEntry[] => [{ cardId: 'card_a', pid: 10, cwd: '/repo' }]

describe('SessionScanner worktree 偵測', () => {
  it('子孫程序的 cwd 落在卡片目錄底下的 worktree 時，回報該 worktree 根目錄', async () => {
    const { state, deps } = fakeEnv()
    // shell 10 → claude 11 → bash 12（在 worktree 裡跑指令）
    state.ps = psLine(10, 1) + psLine(11, 10) + psLine(12, 11)
    state.cwds.set(11, '/repo')
    state.cwds.set(12, '/repo/.worktrees/feat/src')
    state.worktreeRoots.add('/repo/.worktrees/feat')

    const { scanner, onWorktree } = makeScanner(oneCard, deps)
    await scanner.scan()

    expect(onWorktree).toHaveBeenCalledTimes(1)
    expect(onWorktree).toHaveBeenCalledWith('card_a', '/repo/.worktrees/feat')
  })

  it('同一個 worktree 連續掃到只回報一次', async () => {
    const { state, deps } = fakeEnv()
    state.ps = psLine(10, 1) + psLine(12, 10)
    state.cwds.set(12, '/repo/.worktrees/feat')
    state.worktreeRoots.add('/repo/.worktrees/feat')

    const { scanner, onWorktree } = makeScanner(oneCard, deps)
    await scanner.scan()
    await scanner.scan()

    expect(onWorktree).toHaveBeenCalledTimes(1)
  })

  it('跑指令的程序結束後（cwd 不再出現）但 worktree 仍存在時，保留上次結果、不回報', async () => {
    const { state, deps } = fakeEnv()
    state.ps = psLine(10, 1) + psLine(12, 10)
    state.cwds.set(12, '/repo/.worktrees/feat')
    state.worktreeRoots.add('/repo/.worktrees/feat')

    const { scanner, onWorktree } = makeScanner(oneCard, deps)
    await scanner.scan()

    state.ps = psLine(10, 1)
    state.cwds.clear()
    await scanner.scan()

    expect(onWorktree).toHaveBeenCalledTimes(1)
  })

  it('worktree 目錄已被移除（不再是 worktree 根）且沒有新候選時，回報 null 清除，且只清一次', async () => {
    const { state, deps } = fakeEnv()
    state.ps = psLine(10, 1) + psLine(12, 10)
    state.cwds.set(12, '/repo/.worktrees/feat')
    state.worktreeRoots.add('/repo/.worktrees/feat')

    const { scanner, onWorktree } = makeScanner(oneCard, deps)
    await scanner.scan()

    state.ps = psLine(10, 1)
    state.cwds.clear()
    state.worktreeRoots.clear()
    await scanner.scan()
    await scanner.scan()

    expect(onWorktree).toHaveBeenNthCalledWith(2, 'card_a', null)
    expect(onWorktree).toHaveBeenCalledTimes(2)
  })

  it('多個子孫落在不同 worktree 時，以最新啟動的程序為準，不受 ps 排序影響', async () => {
    const { state, deps } = fakeEnv()
    // 12 是幾小時前在 worktree a 起的 dev server；13 是剛剛在 worktree b 跑的指令
    state.ps = psLine(10, 1) + psLine(12, 10, '03:12:00') + psLine(13, 10, '00:02')
    state.cwds.set(12, '/repo/.worktrees/a')
    state.cwds.set(13, '/repo/.worktrees/b')
    state.worktreeRoots.add('/repo/.worktrees/a')
    state.worktreeRoots.add('/repo/.worktrees/b')

    const { scanner, onWorktree } = makeScanner(oneCard, deps)
    await scanner.scan()

    expect(onWorktree).toHaveBeenCalledWith('card_a', '/repo/.worktrees/b')
  })

  it('換到另一個 worktree 時再回報一次新的', async () => {
    const { state, deps } = fakeEnv()
    state.ps = psLine(10, 1) + psLine(12, 10)
    state.cwds.set(12, '/repo/.worktrees/a')
    state.worktreeRoots.add('/repo/.worktrees/a')
    state.worktreeRoots.add('/repo/.worktrees/b')

    const { scanner, onWorktree } = makeScanner(oneCard, deps)
    await scanner.scan()
    state.cwds.set(12, '/repo/.worktrees/b')
    await scanner.scan()

    expect(onWorktree).toHaveBeenNthCalledWith(1, 'card_a', '/repo/.worktrees/a')
    expect(onWorktree).toHaveBeenNthCalledWith(2, 'card_a', '/repo/.worktrees/b')
  })

  it('卡片 cwd 含 symlink 時用 realpath 比對，因為 lsof 回報的是 realpath', async () => {
    const { state, deps } = fakeEnv()
    state.ps = psLine(10, 1) + psLine(12, 10)
    state.realpaths.set('/tmp/repo', '/private/tmp/repo')
    state.cwds.set(12, '/private/tmp/repo/.worktrees/feat')
    state.worktreeRoots.add('/private/tmp/repo/.worktrees/feat')

    const { scanner, onWorktree } = makeScanner(
      () => [{ cardId: 'card_a', pid: 10, cwd: '/tmp/repo' }],
      deps,
    )
    await scanner.scan()

    expect(onWorktree).toHaveBeenCalledWith('card_a', '/private/tmp/repo/.worktrees/feat')
  })

  it('realpath 失敗時退回原路徑並記錄 warning，不會讓整輪掃描中斷', async () => {
    const { state, deps } = fakeEnv()
    state.ps = psLine(10, 1) + psLine(12, 10)
    state.cwds.set(12, '/repo/.worktrees/feat')
    state.worktreeRoots.add('/repo/.worktrees/feat')
    deps.realpath = async () => {
      throw new Error('ENOENT')
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { scanner, onWorktree } = makeScanner(oneCard, deps)
    await scanner.scan()

    expect(onWorktree).toHaveBeenCalledWith('card_a', '/repo/.worktrees/feat')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('pty 重啟（同 cardId 換了 pid）後記憶歸零，同一個 worktree 會重新回報', async () => {
    const { state, deps } = fakeEnv()
    state.ps = psLine(10, 1) + psLine(12, 10) + psLine(20, 1) + psLine(22, 20)
    state.cwds.set(12, '/repo/.worktrees/a')
    state.cwds.set(22, '/repo/.worktrees/a')
    state.worktreeRoots.add('/repo/.worktrees/a')

    let pid = 10
    const { scanner, onWorktree } = makeScanner(
      () => [{ cardId: 'card_a', pid, cwd: '/repo' }],
      deps,
    )
    await scanner.scan()
    pid = 20
    await scanner.scan()

    expect(onWorktree).toHaveBeenCalledTimes(2)
  })

  it('knownWorktrees 列出目前記得的 worktree，供 renderer 重新載入後補送', async () => {
    const { state, deps } = fakeEnv()
    state.ps = psLine(10, 1) + psLine(12, 10)
    state.cwds.set(12, '/repo/.worktrees/a')
    state.worktreeRoots.add('/repo/.worktrees/a')

    const { scanner } = makeScanner(oneCard, deps)
    expect(scanner.knownWorktrees()).toEqual([])
    await scanner.scan()
    expect(scanner.knownWorktrees()).toEqual([{ cardId: 'card_a', worktree: '/repo/.worktrees/a' }])
  })

  it('沒有任何子孫程序時不呼叫 lsof', async () => {
    const { state, deps } = fakeEnv()
    state.ps = psLine(10, 1)
    const lsofSpy = vi.spyOn(deps, 'lsofCwd')

    const { scanner } = makeScanner(oneCard, deps)
    await scanner.scan()

    expect(lsofSpy).not.toHaveBeenCalled()
  })

  it('沒有任何 pty 時完全不呼叫 ps', async () => {
    const { deps } = fakeEnv()
    const psSpy = vi.spyOn(deps, 'ps')

    const { scanner } = makeScanner(() => [], deps)
    await scanner.scan()

    expect(psSpy).not.toHaveBeenCalled()
  })

  it('ps 失敗時記錄 warning 且不拋出', async () => {
    const { deps } = fakeEnv()
    deps.ps = async () => {
      throw new Error('ps 炸了')
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { scanner } = makeScanner(oneCard, deps)
    await expect(scanner.scan()).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('callback 拋錯時記錄 warning，其他卡片照常處理', async () => {
    const { state, deps } = fakeEnv()
    state.ps = psLine(10, 1) + psLine(12, 10) + psLine(20, 1) + psLine(22, 20)
    state.cwds.set(12, '/repo/.worktrees/a')
    state.cwds.set(22, '/repo/.worktrees/a')
    state.worktreeRoots.add('/repo/.worktrees/a')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const scanner = new SessionScanner(
      () => [
        { cardId: 'card_a', pid: 10, cwd: '/repo' },
        { cardId: 'card_b', pid: 20, cwd: '/repo' },
      ],
      deps,
    )
    const seen: string[] = []
    scanner.onWorktree((cardId) => {
      seen.push(cardId)
      if (cardId === 'card_a') throw new Error('renderer 已關閉')
    })
    await expect(scanner.scan()).resolves.toBeUndefined()

    expect(seen).toEqual(['card_a', 'card_b'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('SessionScanner Claude 完成偵測', () => {
  function busyThen(next: string) {
    const { state, deps } = fakeEnv()
    state.ps = psLine(10, 1) + psLine(11, 10)
    state.sessions.set(11, { status: 'busy', procStart: START })
    const { scanner, onIdle } = makeScanner(oneCard, deps)
    return {
      run: async () => {
        await scanner.scan()
        state.sessions.set(11, { status: next, procStart: START })
        await scanner.scan()
        return onIdle
      },
      state,
      scanner,
      onIdle,
    }
  }

  it('busy → idle 時回報一次', async () => {
    const onIdle = await busyThen('idle').run()
    expect(onIdle).toHaveBeenCalledTimes(1)
    expect(onIdle).toHaveBeenCalledWith('card_a')
  })

  it('busy → waiting（等待使用者回覆）也算需要注意，回報一次', async () => {
    const onIdle = await busyThen('waiting').run()
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('busy → shell（回合結束但背景 bash 還在跑）同樣代表回合結束，回報一次', async () => {
    const onIdle = await busyThen('shell').run()
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('busy → 未知的新狀態值：仍視為回合結束回報，並記錄 warning 提醒狀態集合可能已變', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { run, scanner } = busyThen('compacting')
    const onIdle = await run()
    await scanner.scan()

    expect(onIdle).toHaveBeenCalledTimes(1)
    // 同一個未知值只警告一次，否則每 3 秒刷一行
    expect(warn.mock.calls.filter(([msg]) => String(msg).includes('未知')).length).toBe(1)
    warn.mockRestore()
  })

  it('持續 idle 不會重複回報', async () => {
    const { run, scanner, onIdle } = busyThen('idle')
    await run()
    await scanner.scan()
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('第一次看到就是 idle（剛啟動還沒做事）不回報', async () => {
    const { state, deps } = fakeEnv()
    state.ps = psLine(10, 1) + psLine(11, 10)
    state.sessions.set(11, { status: 'idle', procStart: START })
    const { scanner, onIdle } = makeScanner(oneCard, deps)
    await scanner.scan()
    expect(onIdle).not.toHaveBeenCalled()
  })

  it('busy 中 Claude 直接結束（session 檔消失）不回報', async () => {
    const { run, state, scanner, onIdle } = busyThen('busy')
    await run()
    state.sessions.clear()
    await scanner.scan()
    expect(onIdle).not.toHaveBeenCalled()
  })

  it('session 檔暫時讀不到（Claude 正在改寫）時保留上一輪記憶，下一輪讀到 idle 仍會回報', async () => {
    const { run, state, scanner, onIdle } = busyThen('busy')
    await run()
    state.sessions.set(11, 'unreadable')
    await scanner.scan()
    expect(onIdle).not.toHaveBeenCalled()

    state.sessions.set(11, { status: 'idle', procStart: START })
    await scanner.scan()
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('主 session 檔讀不到時不會往下改讀 teammate 的狀態', async () => {
    const { state, deps } = fakeEnv()
    // shell 10 → claude 11（主 session）→ claude 12（teammate）
    state.ps = psLine(10, 1) + psLine(11, 10) + psLine(12, 11)
    state.sessions.set(11, { status: 'busy', procStart: START })
    state.sessions.set(12, { status: 'idle', procStart: START })
    const { scanner, onIdle } = makeScanner(oneCard, deps)
    await scanner.scan()
    state.sessions.set(11, 'unreadable')
    await scanner.scan()
    expect(onIdle).not.toHaveBeenCalled()
  })

  it('session 檔的 procStart 與 ps 的啟動時間不符（pid 被回收的陳舊檔）時忽略該檔', async () => {
    const { state, deps } = fakeEnv()
    state.ps = psLine(10, 1) + psLine(11, 10, '00:10', 'Thu Sep  3 10:00:00 2026')
    state.sessions.set(11, { status: 'busy', procStart: 'Wed Sep  2 01:42:20 2026' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { scanner, onIdle } = makeScanner(oneCard, deps)
    await scanner.scan()
    state.sessions.set(11, { status: 'idle', procStart: 'Wed Sep  2 01:42:20 2026' })
    await scanner.scan()

    expect(onIdle).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('procStart 的多重空白差異（單位數日期）不影響比對', async () => {
    const { state, deps } = fakeEnv()
    state.ps = psLine(10, 1) + psLine(11, 10, '00:10', 'Wed Sep  2 01:42:20 2026')
    state.sessions.set(11, { status: 'busy', procStart: 'Wed Sep 2 01:42:20 2026' })
    const { scanner, onIdle } = makeScanner(oneCard, deps)
    await scanner.scan()
    state.sessions.set(11, { status: 'idle', procStart: 'Wed Sep 2 01:42:20 2026' })
    await scanner.scan()
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('多層子孫都有 session 檔時，以最靠近 shell 的那個為準', async () => {
    const { state, deps } = fakeEnv()
    state.ps = psLine(10, 1) + psLine(11, 10) + psLine(12, 11)
    state.sessions.set(11, { status: 'busy', procStart: START })
    state.sessions.set(12, { status: 'idle', procStart: START })
    const { scanner, onIdle } = makeScanner(oneCard, deps)
    await scanner.scan()
    state.sessions.set(12, { status: 'busy', procStart: START })
    await scanner.scan()
    // 只有 teammate 變動，主 session 仍 busy → 不回報
    expect(onIdle).not.toHaveBeenCalled()
  })
})

describe('SessionScanner start / stop', () => {
  it('start 後依間隔重複掃描，stop 後停止', async () => {
    vi.useFakeTimers()
    try {
      const { state, deps } = fakeEnv()
      state.ps = psLine(10, 1)
      const psSpy = vi.spyOn(deps, 'ps')
      const { scanner } = makeScanner(oneCard, deps)

      scanner.start(1000)
      await vi.advanceTimersByTimeAsync(2500)
      expect(psSpy).toHaveBeenCalledTimes(2)

      scanner.stop()
      await vi.advanceTimersByTimeAsync(5000)
      expect(psSpy).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('前一次掃描還沒結束時不會重疊執行', async () => {
    const { state, deps } = fakeEnv()
    state.ps = psLine(10, 1)
    let release: () => void = () => {}
    deps.ps = () =>
      new Promise((resolve) => {
        release = () => resolve(state.ps)
      })
    const psSpy = vi.spyOn(deps, 'ps')
    const { scanner } = makeScanner(oneCard, deps)

    const first = scanner.scan()
    const second = scanner.scan()
    release()
    await Promise.all([first, second])

    expect(psSpy).toHaveBeenCalledTimes(1)
  })
})
