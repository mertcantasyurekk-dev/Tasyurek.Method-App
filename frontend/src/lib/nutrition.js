// Taşyürek Method: daily nutrition — macros, water, sleep — and the coach's targets for them.
//
// S.nutrition = { 'YYYY-MM-DD': { p, c, f, water, sleep, type, _ts } }
//   p c f   the day's totals in grams of protein / carbs / fat — what the coach looks at. What was
//           eaten meal by meal is deliberately not kept: a day is a handful of numbers (~60 bytes),
//           so a member's document holds years of it.
//   type    'training' | 'rest' when the member picked the day type by hand; absent = automatic
// A day written before this shape carries `items` ([{ p, c, f }]); it is read as their sum and
// becomes plain totals the first time the day is edited.
// Body weight stays where openGym keeps it (S.bodyweight).
//
// Targets: S.coachTargets (from the coach's plan, read-only for a member) or, for the coach's own
// training, S.myTargets. { training: { p, c, f }, rest: { p, c, f }, water, sleep }.
import { effectiveRoutineIds } from './history.js'

export const kcalOf = ({ p = 0, c = 0, f = 0 } = {}) => Math.round(p * 4 + c * 4 + f * 9)
const n = v => { const x = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(x) && x > 0 ? x : 0 }
const r1 = v => Math.round(v * 10) / 10

export function dayOf(S, iso) {
  const d = S?.nutrition?.[iso]
  return d && typeof d === 'object' ? d : null
}

const hasTotals = day => !!day && ['p', 'c', 'f'].some(k => day[k] != null)

export function totalsOf(day) {
  const t = { p: 0, c: 0, f: 0 }
  if (hasTotals(day)) { t.p = n(day.p); t.c = n(day.c); t.f = n(day.f) }
  else for (const it of Array.isArray(day?.items) ? day.items : []) { t.p += n(it?.p); t.c += n(it?.c); t.f += n(it?.f) }
  t.p = r1(t.p); t.c = r1(t.c); t.f = r1(t.f)
  return { ...t, kcal: kcalOf(t) }
}

// Whether anything was entered for the day (totals, water or sleep).
export const loggedDay = day => !!day && (totalsOf(day).kcal > 0 || n(day.water) > 0 || n(day.sleep) > 0)

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
  // An old day kept per item: fold it into totals on first edit.
  if (!hasTotals(d) && Array.isArray(d.items)) { const t = totalsOf(d); d.p = t.p; d.c = t.c; d.f = t.f }
  delete d.items; delete d.del
  s.nutrition[iso] = d
  return d
}
const stamp = (d, now) => { d._ts = now; return d }
const clampG = (v, max) => Math.min(max, r1(n(v)))

// Add what was just eaten to the day. Returns false when there was nothing to add.
export function addToDay(s, iso, { p, c, f }, now = Date.now()) {
  if (!(n(p) || n(c) || n(f))) return false
  const d = stamp(ensureDay(s, iso), now)
  d.p = clampG(n(d.p) + n(p), 2000); d.c = clampG(n(d.c) + n(c), 3000); d.f = clampG(n(d.f) + n(f), 1000)
  return true
}
// Put the day's totals right (a typo, a forgotten meal).
export function setTotals(s, iso, { p, c, f }, now = Date.now()) {
  const d = stamp(ensureDay(s, iso), now)
  d.p = clampG(p, 2000); d.c = clampG(c, 3000); d.f = clampG(f, 1000)
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

// Per day, the copy edited last. A day is a few numbers the member keeps correcting as a whole,
// so the newest version of it is the right one.
export function mergeNutrition(a, b) {
  const A = a && typeof a === 'object' ? a : {}, B = b && typeof b === 'object' ? b : {}
  const out = {}
  for (const iso of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const x = A[iso], y = B[iso]
    const pick = !x ? y : !y ? x : (Number(y._ts) || 0) > (Number(x._ts) || 0) ? y : x
    out[iso] = JSON.parse(JSON.stringify(pick))
  }
  return out
}
