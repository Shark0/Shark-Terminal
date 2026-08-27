/**
 * 子序列比對：query 的字元需依序出現在 target 中，允許中間有其他字元。
 * 逐字元比對，中文與英文一體適用。
 */
export function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase()
  if (q === '') return true

  const t = target.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi += 1
  }
  return qi === q.length
}
