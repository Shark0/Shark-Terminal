/** 把家目錄縮寫成 ~，路徑過長時只留最後兩層 */
export function shortenPath(cwd: string, home: string): string {
  // 必須檢查分隔符邊界，否則 /Users/sharkbait 這種路徑會被誤判成家目錄底下
  // （單純用 startsWith(home) 比對，'/Users/sharkbait'.startsWith('/Users/shark') 會是 true）
  const path = cwd === home || cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd
  const parts = path.split('/')
  return parts.length <= 3 ? path : `…/${parts.slice(-2).join('/')}`
}
