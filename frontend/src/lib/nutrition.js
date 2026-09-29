// Taşyürek Method: daily nutrition — macros, water, sleep — and the coach's targets for them.
//
// S.nutrition = { 'YYYY-MM-DD': { items: [{ id, name, p, c, f, t }], del: [id], water, sleep, type, _ts } }
//   items   what was eaten, in grams of protein / carbs / fat. A quick add is one item; the meal
//           log will add more of the same shape, so every total here keeps working.
//   del     ids removed on this device, so a sync with another copy does not bring them back
//   type    'training' | 'rest' when the member picked the day type by hand; absent = automatic
// Body weight stays where openGym keeps it (S.bodyweight).
//
// Targets: S.coachTargets (from the coach's plan, read-only for a member) or, for the coach's own
// training, S.myTargets. { training: { p, c, f }, rest: { p, c, f }, water, sleep }.
import { uid } from './format.js'
import { effectiveRoutineIds } from './history.js'

export const kcalOf = ({ p = 0, c = 0, f = 0 } = {}) => Math.round(p * 4 + c * 4 + f * 9)
const n = v => { const x = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(x) && x > 0 ? x : 0 }
const r1 = v => Math.round(v * 10) / 10

export function dayOf(S, iso) {
  const d = S?.nutrition?.[iso]
  return d && typeof d === 'object' ? d : null
}

export function totalsOf(day) {
  const t = { p: 0, c: 0, f: 0 }
  for (const it of Array.isArray(day?.items) ? day.items : []) { t.p += n(it?.p); t.c += n(it?.c); t.f += n(it?.f) }
  t.p = r1(t.p); t.c = r1(t.c); t.f = r1(t.f)
  return { ...t, kcal: kcalOf(t) }
}

export const targetsOf = S => S?.coachTargets || S?.myTargets || null

const hasSet = s => !!s && (n(s.p) || n(s.c) || n(s.f)) > 0

// Training day when the member said so, else when a routine is planned or a workout was logged.
export function dayTypeOf(S, iso) {
  const set = dayOf(S, iso)?.type
  if (set === 'training' || set === 'rest') return set
  const trained = (S?.workouts || []).some(w => w?.d === iso)
  let planned = false
  try { planned = effectiveRoutineIds(S, iso).length > 0 } catch { planned = false }
  return trained || planned ? 'training' : 'rest'
}

// The macro set that applies to a day, and which one it is. With only one set given, that one.
export function macroTargetFor(S, iso) {
  const T = targetsOf(S)
  if (!T) return null
  const type = dayTypeOf(S, iso)
  const both = hasSet(T.training) && hasSet(T.rest)
  const set = both ? T[type] : hasSet(T.training) ? T.training : hasSet(T.rest) ? T.rest : null
  if (!set) return null
  const m = { p: n(set.p), c: n(set.c), f: n(set.f) }
  return { ...m, kcal: kcalOf(m), type: both ? type : null }
}

/* ---- edits: call inside store.update(s => …) ---- */

function ensureDay(s, iso) {
  if (!s.nutrition || typeof s.nutrition !== 'object') s.nutrition = {}
  const d = s.nutrition[iso] && typeof s.nutrition[iso] === 'object' ? s.nutrition[iso] : {}
  d.items = Array.isArray(d.items) ? d.items : []
  s.nutrition[iso] = d
  return d
}
const stamp = (d, now) => { d._ts = now; return d }

export function addItem(s, iso, { name = '', p, c, f }, now = Date.now()) {
  const item = { id: 'n' + uid(), name: String(name || '').trim().slice(0, 80), p: r1(n(p)), c: r1(n(c)), f: r1(n(f)), t: now }
  if (!item.p && !item.c && !item.f) return null
  stamp(ensureDay(s, iso), now).items.push(item)
  return item
}
export function removeItem(s, iso, id, now = Date.now()) {
  const d = ensureDay(s, iso)
  d.items = d.items.filter(it => it.id !== id)
  d.del = [...new Set([...(Array.isArray(d.del) ? d.del : []), id])]
  stamp(d, now)
}
export function setWater(s, iso, liters, now = Date.now()) {
  stamp(ensureDay(s, iso), now).water = Math.max(0, Math.min(15, Math.round(n(liters) * 4) / 4))
}
export function setSleep(s, iso, hours, now = Date.now()) {
  stamp(ensureDay(s, iso), now).sleep = Math.max(0, Math.min(24, Math.round(n(hours) * 2) / 2))
}
export function setDayType(s, iso, type, now = Date.now()) {
  const d = stamp(ensureDay(s, iso), now)
  if (type === 'training' || type === 'rest') d.type = type; else delete d.type
}

/* ---- sync: two copies of the log become one ---- */

// Per day: every item either side has, minus what either side deleted; water, sleep and the day
// type from the side that edited the day last. Nothing entered on one phone is lost to the other.
export function mergeNutrition(a, b) {
  const A = a && typeof a === 'object' ? a : {}, B = b && typeof b === 'object' ? b : {}
  const out = {}
  for (const iso of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const x = A[iso], y = B[iso]
    if (!x || !y) { out[iso] = JSON.parse(JSON.stringify(x || y)); continue }
    const newer = (Number(y._ts) || 0) > (Number(x._ts) || 0) ? y : x
    const del = new Set([...(x.del || []), ...(y.del || [])])
    const items = new Map()
    for (const it of [...(x.items || []), ...(y.items || [])]) if (it?.id && !del.has(it.id) && !items.has(it.id)) items.set(it.id, it)
    const day = { ...JSON.parse(JSON.stringify(newer)), items: [...items.values()].sort((i, j) => (i.t || 0) - (j.t || 0)).map(i => ({ ...i })) }
    if (del.size) day.del = [...del]
    day._ts = Math.max(Number(x._ts) || 0, Number(y._ts) || 0)
    out[iso] = day
  }
  return out
}
