import type { Card } from '@shared/types'

/** 預設 branch：每張卡片都在上面，顯示出來只是雜訊 */
const DEFAULT_BRANCHES = new Set(['master', 'main'])

export interface Badge {
  text: string
  /** hover 顯示的完整內容 */
  title: string
}

/**
 * 卡片與終端機標頭右側的小標籤。
 * 有 worktree 顯示其目錄名（title 是完整路徑）——session 在 worktree 裡工作時，
 * cwd 的 branch（通常是 master）沒有參考價值；
 * 否則顯示 branch，但 master / main 不顯示。
 * branch 為 null 代表非 git 目錄，undefined 代表尚未查詢，兩者都不顯示。
 */
export function cardBadge(
  card: Pick<Card, 'worktree'>,
  branch: string | null | undefined,
): Badge | null {
  if (card.worktree) {
    return { text: card.worktree.split('/').pop() ?? card.worktree, title: card.worktree }
  }
  if (!branch || DEFAULT_BRANCHES.has(branch)) return null
  return { text: branch, title: branch }
}
