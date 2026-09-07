// 拖曳卡片的煙霧測試：用 Chrome DevTools Protocol 對 dev 模式的 app 自動拖曳，
// 監聽 renderer 的例外與 console 錯誤，並確認 React 樹沒有被卸載、版面變動符合預期。
//
// 用途：dnd-kit 的碰撞偵測與 onDragOver 互相追逐時會讓 React 丟出
// Maximum update depth exceeded、整棵樹卸載、視窗黑掉（0.1.2 的 bug），jsdom 重現不了，
// 只能在真的 Electron 裡跑。
//
// 使用方式（兩個終端機）：
//   npm run dev:debug          # dev 模式 + remote debugging port 9333，用 ~/.sharkterminal/board.dev.json
//   npm run smoke:drag         # 需要看板至少有：兩欄各有 ≥1 張卡片、一個空欄，且都在視窗可見範圍內
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PORT = Number(process.env.DEBUG_PORT ?? 9333)
const SHOTS = process.env.SHOTS_DIR ?? path.join(tmpdir(), 'shark-terminal-drag-smoke')
mkdirSync(SHOTS, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const failures = []
const fail = (msg) => {
  failures.push(msg)
  console.log('  ✗', msg)
}
const ok = (msg) => console.log('  ✓', msg)

async function findPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const page = list.find((t) => t.type === 'page' && /localhost|127\.0\.0\.1/.test(t.url))
      if (page) return page
    } catch {
      /* dev 還沒起來，再等 */
    }
    await sleep(500)
  }
  throw new Error(`找不到 renderer（port ${PORT}），請先 npm run dev:debug`)
}

const page = await findPage()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))

let seq = 0
const pending = new Map()
const errors = []
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
    return
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails
    errors.push(d.exception?.description ?? d.text)
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
  }
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error('evaluate 失敗: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result.value
}
await send('Runtime.enable')
await send('Page.enable')

/** 目前的欄位與卡片版面（DOM 幾何） */
async function layout() {
  for (let i = 0; i < 40; i++) {
    if ((await evaluate(`document.querySelectorAll('[data-testid="column"]').length`)) > 0) break
    await sleep(250)
  }
  const json = await evaluate(`
    JSON.stringify([...document.querySelectorAll('[data-testid="column"]')].map((col) => {
      const r = col.getBoundingClientRect()
      return {
        title: col.dataset.title,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        // 卡片本體是 div[role=button]；欄位標題是 <button>，不會被選到
        cards: [...col.querySelectorAll('div[role="button"]')].map((c) => {
          const cr = c.getBoundingClientRect()
          return { title: c.querySelector('span')?.textContent ?? '', x: cr.x, y: cr.y, w: cr.width, h: cr.height }
        }),
      }
    }))
  `)
  return JSON.parse(json)
}
const counts = (cols) => cols.map((c) => `${c.title}:${c.cards.length}`).join(' ')
const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
const rootAlive = () => evaluate(`document.getElementById('root').children.length > 0`)
const boundaryShown = () => evaluate(`document.body.innerText.includes('畫面發生錯誤')`)

let shotIndex = 0
async function shot(label) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  const file = path.join(SHOTS, `${String(shotIndex++).padStart(2, '0')}-${label}.png`)
  writeFileSync(file, Buffer.from(r.data, 'base64'))
  return file
}
async function mouse(type, x, y, extra = {}) {
  await send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: 'left',
    clickCount: type === 'mouseMoved' ? 0 : 1,
    ...extra,
  })
}

/** 按住 from、分 steps 步移到 to、放開；途中任一步 React 樹消失就立刻回報 */
async function drag(from, to, steps = 24) {
  await mouse('mouseMoved', from.x, from.y)
  await mouse('mousePressed', from.x, from.y)
  await sleep(50)
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps
    const y = from.y + ((to.y - from.y) * i) / steps
    await mouse('mouseMoved', x, y, { buttons: 1 })
    await sleep(30)
    if (!(await rootAlive())) return false
  }
  await sleep(80)
  await mouse('mouseReleased', to.x, to.y)
  await sleep(350)
  return rootAlive()
}

async function scenario(name, run) {
  console.log(`\n=== ${name}`)
  const errorsBefore = errors.length
  const before = await layout()
  console.log('  before:', counts(before))
  const alive = await run(before)
  const after = await layout()
  console.log('  after: ', counts(after))
  if (!alive) fail('React 樹被卸載（畫面黑掉）')
  if (await boundaryShown()) fail('ErrorBoundary 顯示錯誤畫面')
  const newErrors = errors.slice(errorsBefore)
  if (newErrors.length > 0) fail(`renderer 錯誤 ${newErrors.length} 筆：${newErrors[0].slice(0, 200)}`)
  await shot(name.replace(/[^\p{L}\p{N}_-]+/gu, '_'))
  return after
}
const byTitle = (cols, title) => cols.find((c) => c.title === title)
const win = JSON.parse(await evaluate(`JSON.stringify({ w: window.innerWidth, h: window.innerHeight })`))

const initial = await layout()
const source = initial.find((c) => c.cards.length >= 2 && c.rect.x + c.rect.w < win.w)
const empty = initial.find((c) => c.cards.length === 0 && c.rect.x + c.rect.w < win.w)
const other = initial.find((c) => c !== source && c.cards.length >= 1 && c.rect.x + c.rect.w < win.w)
if (!source || !empty || !other) {
  console.log('看板不符合前置條件（需要：一欄 ≥2 張、一空欄、另一欄 ≥1 張，且都在視窗內）：', counts(initial))
  process.exit(2)
}
console.log('視窗', win, '| 來源欄', source.title, '| 空欄', empty.title, '| 另一欄', other.title)

// 1. 同欄重排：來源欄第一張拖到最後一張的位置
await scenario('同欄重排', async (cols) => {
  const col = byTitle(cols, source.title)
  const first = col.cards[0].title
  const alive = await drag(center(col.cards[0]), center(col.cards[col.cards.length - 1]))
  const after = byTitle(await layout(), source.title)
  if (after.cards[after.cards.length - 1]?.title === first) ok('第一張已移到末端')
  else fail(`順序未改變：${after.cards.map((c) => c.title).join(' | ')}`)
  return alive
})

// 2. 跨欄到空欄
await scenario('跨欄拖到空欄', async (cols) => {
  const alive = await drag(center(byTitle(cols, source.title).cards[0]), center(byTitle(cols, empty.title).rect))
  const after = await layout()
  if (byTitle(after, empty.title).cards.length === 1) ok('空欄收到卡片')
  else fail(`空欄卡片數 ${byTitle(after, empty.title).cards.length}`)
  return alive
})

// 3. 跨欄放到另一欄的第一張卡片上（0.1.2 會在這裡無限翻轉）
await scenario('跨欄放到卡片上', async (cols) => {
  const from = byTitle(cols, source.title)
  const to = byTitle(cols, other.title)
  const n = to.cards.length
  const alive = await drag(center(from.cards[0]), center(to.cards[0]))
  const after = await layout()
  if (byTitle(after, other.title).cards.length === n + 1) ok('目標欄多了一張')
  else fail(`目標欄卡片數 ${byTitle(after, other.title).cards.length}，預期 ${n + 1}`)
  return alive
})

// 4. 在兩欄縫隙來回晃（碰撞翻轉的高風險位置）
await scenario('欄位縫隙來回', async (cols) => {
  const from = byTitle(cols, other.title)
  const fromCard = center(from.cards[0])
  const gapX = from.rect.x + from.rect.w + 6
  const y = from.rect.y + 60
  await mouse('mouseMoved', fromCard.x, fromCard.y)
  await mouse('mousePressed', fromCard.x, fromCard.y)
  await sleep(50)
  let alive = true
  for (let i = 0; i < 16; i++) {
    await mouse('mouseMoved', gapX + (i % 2 === 0 ? -10 : 10), y, { buttons: 1 })
    await sleep(45)
    if (!(await rootAlive())) {
      alive = false
      break
    }
  }
  await mouse('mouseReleased', gapX, y)
  await sleep(350)
  if (alive) ok('來回 16 次仍存活')
  return alive && (await rootAlive())
})

// 5. 拖到視窗右緣（可能超出所有可放置目標）
await scenario('拖到視窗右緣', async (cols) => {
  const from = cols.find((c) => c.cards.length > 0 && c.rect.x + c.rect.w < win.w)
  return drag(center(from.cards[0]), { x: win.w - 12, y: 200 }, 30)
})

// 6. 拖到終端機區放開（沒有目標 → 還原）
await scenario('拖到終端機區放開', async (cols) => {
  const from = cols.find((c) => c.cards.length > 0 && c.rect.x + c.rect.w < win.w)
  const before = counts(cols)
  const alive = await drag(center(from.cards[0]), { x: 400, y: win.h - 60 })
  const after = counts(await layout())
  if (after === before) ok('版面還原')
  else fail(`版面未還原：${after}`)
  return alive
})

console.log(`\n截圖：${SHOTS}`)
if (failures.length > 0) {
  console.log(`\n失敗 ${failures.length} 項：\n- ${failures.join('\n- ')}`)
  ws.close()
  process.exit(1)
}
console.log('\n全部通過')
ws.close()
