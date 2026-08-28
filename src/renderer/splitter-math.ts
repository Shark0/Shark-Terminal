/**
 * Splitter 的純數學計算，獨立成不依賴 DOM/React 的 .ts 檔案——
 * 這樣測試可以直接 import，不需要透過會拉進 tsx/JSX 解析的 Splitter.tsx
 * （tsconfig.node.json 涵蓋 tests/**，但沒有設定 jsx，import .tsx 會編譯失敗）。
 */
export const MIN_RATIO = 0.2
export const MAX_RATIO = 0.8

/**
 * 依滑鼠 Y 座標算出看板佔比。
 *
 * 推導：`containerHeight` 是「看板區＋這條分隔線＋終端機區」三者共同父容器的高度，
 * 也就是看板區高度 + 分隔線高度 + 終端機區高度。看板區與終端機區是 flexGrow 為
 * ratio / (1-ratio) 的彈性子元素，兩者瓜分的「自由空間」= containerHeight - splitterHeight
 * （分隔線本身是 shrink-0，不參與瓜分）。看板區高度 = 自由空間 * ratio，其上緣即
 * `containerTop`；分隔線中心的絕對 y 座標 = containerTop + 看板區高度 + splitterHeight / 2。
 * 要讓分隔線中心跟著滑鼠（拖曳體感才會「跟手」），令這個 y 座標等於 clientY 解 ratio：
 *   clientY = containerTop + freeSpace * ratio + splitterHeight / 2
 *   ratio = (clientY - containerTop - splitterHeight / 2) / freeSpace
 */
export function computeRatio(
  clientY: number,
  containerTop: number,
  containerHeight: number,
  splitterHeight: number,
): number {
  const freeSpace = containerHeight - splitterHeight
  const ratio = (clientY - containerTop - splitterHeight / 2) / freeSpace
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio))
}
