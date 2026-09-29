// Taşyürek Method: the nutrition log's core — totals, the weekly seal, and sync. No imports, so the
// Firebase adapter can apply the seal to every write without pulling the app in.
//
// A day: { p, c, f, items, del, water, sleep, type, sealedAt, _ts }
//   items     what was eaten this week, meal by meal: [{ id, m, n, q, u, p, c, f, t }]
//             m meal ('b' breakfast, 'l' lunch, 'd' dinner, 's' snack), n name, q/u quantity and unit,
//             p c f grams of macros for that quantity, t when it was added. A correction ("the day
//             was really this much") is an item with x: 1 and possibly negative grams.
//   p c f     the day's base totals: what earlier weeks folded into (and days from before items)
//   del       ids removed this week, so a sync does not bring them back
// Totals = base + items. When a week is over its days are sealed: items fold into the base and are
// dropped. What stays behind for good is the day's kcal and macros — never what was eaten.

export const kcalOf = ({ p = 0, c = 0, f = 0 } = {}) => Math.round(p * 4 + c * 4 + f * 9)
const num = v => { const x = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(x) ? x : 0 }
const pos = v => Math.max(0, num(v))
const r1 = v => Math.round(v * 10) / 10

export function totalsOf(day) {
  const t = { p: pos(day?.p), c: pos(day?.c), f: pos(day?.f) }
  for (const it of Array.isArray(day?.items) ? day.items : []) { t.p += num(it?.p); t.c += num(it?.c); t.f += num(it?.f) }
  t.p = r1(Math.max(0, t.p)); t.c = r1(Math.max(0, t.c)); t.f = r1(Math.max(0, t.f))
  return { ...t, kcal: kcalOf(t) }
}

/* ---- the weekly seal ---- */

const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const todayLocal = () => isoOf(new Date())

// First day of the week `iso` is in; weekStart 1 = Monday (openGym's default), 0 = Sunday.
export function weekStartIso(iso, weekStart = 1) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() - ((d.getDay() - weekStart + 7) % 7))
  return isoOf(d)
}

export function sealDay(day, now = Date.now()) {
  const t = totalsOf(day)
  day.p = t.p; day.c = t.c; day.f = t.f
  delete day.items; delete day.del
  day.sealedAt = now
  day._ts = Math.max(Number(day._ts) || 0, now)
  return day
}

// Seal every day of an earlier week that still holds meals. Returns how many were sealed.
export function compactNutrition(S, today = todayLocal(), now = Date.now()) {
  const log = S?.nutrition
  if (!log || typeof log !== 'object') return 0
  const from = weekStartIso(today, S.weekStart === 0 ? 0 : 1)
  let n = 0
  for (const [iso, day] of Object.entries(log)) {
    if (iso >= from || !day || typeof day !== 'object') continue
    if (Array.isArray(day.items) || Array.isArray(day.del)) { sealDay(day, now); n++ }
  }
  return n
}

/* ---- sync: two copies of the log become one ---- */

// Per day: base totals from the copy that sealed last (or, unsealed, the one edited last); items
// from both copies, minus anything either deleted — and, on a sealed day, only items added after
// the seal (the ones before it are already in the base, and must not be counted twice). Water,
// sleep and the day type from the copy edited last.
export function mergeNutrition(a, b) {
  const A = a && typeof a === 'object' ? a : {}, B = b && typeof b === 'object' ? b : {}
  const out = {}
  const copy = v => JSON.parse(JSON.stringify(v))
  for (const iso of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const x = A[iso], y = B[iso]
    if (!x || !y) { out[iso] = copy(x || y); continue }
    const sx = Number(x.sealedAt) || 0, sy = Number(y.sealedAt) || 0
    const seal = Math.max(sx, sy)
    const newer = (Number(y._ts) || 0) > (Number(x._ts) || 0) ? y : x
    const baseFrom = seal ? (sy > sx ? y : sx > sy ? x : newer) : newer
    const del = new Set([...(x.del || []), ...(y.del || [])])
    const items = new Map()
    for (const it of [...(x.items || []), ...(y.items || [])]) {
      if (!it?.id || del.has(it.id) || items.has(it.id)) continue
      if (seal && !((Number(it.t) || 0) > seal)) continue
      items.set(it.id, it)
    }
    const day = copy(newer)
    for (const k of ['p', 'c', 'f']) { if (baseFrom[k] != null) day[k] = baseFrom[k]; else delete day[k] }
    delete day.items; delete day.del; delete day.sealedAt
    if (items.size) day.items = [...items.values()].sort((i, j) => (i.t || 0) - (j.t || 0)).map(copy)
    if (items.size && del.size) day.del = [...del]
    if (seal) day.sealedAt = seal
    day._ts = Math.max(Number(x._ts) || 0, Number(y._ts) || 0)
    out[iso] = day
  }
  return out
}
