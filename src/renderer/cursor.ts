/** 把游標夾在 [0, rowCount-1]；rowCount 為 0 時回 0，避免負數索引讓 Enter 靜默失效 */
export function clampCursor(cursor: number, rowCount: number): number {
  return Math.max(0, Math.min(cursor, rowCount - 1))
}
