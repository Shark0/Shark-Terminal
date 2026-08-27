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
