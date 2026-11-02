/**
 * 等工作完成，但最多等 ms 毫秒。
 * 用 setTimeout 計時：它跑在 event loop 上、不經過 libuv threadpool，
 * 即使 threadpool 被卡死、fs 操作永遠不回來，期限照樣會到。
 * 工作 reject 時照樣往外拋，由呼叫端記錄。
 */
export async function runWithDeadline(task: Promise<unknown>, ms: number): Promise<'done' | 'timeout'> {
  let timer: NodeJS.Timeout | null = null
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms)
  })
  try {
    return await Promise.race([task.then(() => 'done' as const), deadline])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
