// Taşyürek Method: daily nutrition — what the member eats this week, the day's totals, water,
// sleep — and the coach's targets for them. The day model, the weekly seal and sync live in
// lib/nutrition-core.js; this file adds the edits and the targets.
//
// Targets: S.coachTargets (from the coach's plan, read-only for a member) or, for the coach's own
// training, S.myTargets. { training: { p, c, f }, rest: { p, c, f }, water, sleep }.
import { uid } from './format.js'
import { effectiveRoutineIds } from './history.js'
import { kcalOf, totalsOf, mergeNutrition, compactNutrition, sealDay, weekStartIso, todayLocal } from './nutrition-core.js'

export { kcalOf, totalsOf, mergeNutrition, compactNutrition, sealDay, weekStartIso }
const n = v => { const x = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(x) && x > 0 ? x : 0 }
const signed = v => { const x = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(x) ? x : 0 }
const r1 = v => Math.round(v * 10) / 10

export const MEALS = [['b', 'Kahvaltı'], ['l', 'Öğle'], ['d', 'Akşam'], ['s', 'Ara öğün']]
export const mealByHour = (h = new Date().getHours()) => (h < 11 ? 'b' : h < 16 ? 'l' : h < 21 ? 'd' : 's')

export function dayOf(S, iso) {
  const d = S?.nutrition?.[iso]
  return d && typeof d === 'object' ? d : null
}

// Whether anything was entered for the day (totals, water or sleep).
export const loggedDay = day => !!day && (totalsOf(day).kcal > 0 || n(day.water) > 0 || n(day.sleep) > 0)

// A day of an earlier week: its meals are gone, only the totals remain.
export const isClosedDay = (S, iso, today = todayLocal()) => iso < weekStartIso(today, S?.weekStart === 0 ? 0 : 1)

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
  s.nutrition[iso] = d
  return d
}
const stamp = (d, now) => { d._ts = now; return d }

function pushItem(s, iso, item, now) {
  const d = stamp(ensureDay(s, iso), now)
  d.items = Array.isArray(d.items) ? d.items : []
  const it = { id: 'n' + uid(), ...item, t: now }
  d.items.push(it)
  return it
}

// A food from the list, in some amount. `macros` are already computed for that amount.
export function addFood(s, iso, { meal, fid, name, qty, unit, p, c, f }, now = Date.now()) {
  const m = { p: r1(n(p)), c: r1(n(c)), f: r1(n(f)) }
  if (!(m.p || m.c || m.f)) return null
  return pushItem(s, iso, { m: meal || mealByHour(), ...(fid ? { fid } : {}), n: String(name || '').slice(0, 80), q: r1(n(qty)) || 1, u: unit || null, ...m }, now)
}

// Just grams, no food: "Hızlı ekleme".
export function addToDay(s, iso, { p, c, f, meal }, now = Date.now()) {
  const m = { p: r1(n(p)), c: r1(n(c)), f: r1(n(f)) }
  if (!(m.p || m.c || m.f)) return false
  pushItem(s, iso, { m: meal || mealByHour(), n: 'Hızlı ekleme', ...m }, now)
  return true
}

export function removeItem(s, iso, id, now = Date.now()) {
  const d = stamp(ensureDay(s, iso), now)
  d.items = (Array.isArray(d.items) ? d.items : []).filter(it => it.id !== id)
  d.del = [...new Set([...(Array.isArray(d.del) ? d.del : []), id])]
}

// "The day was really this much": a correction item for the difference, so it syncs like any other.
export function setTotals(s, iso, { p, c, f }, now = Date.now()) {
  const cur = totalsOf(dayOf(s, iso))
  const dp = r1(n(p) - cur.p), dc = r1(n(c) - cur.c), df = r1(n(f) - cur.f)
  if (!dp && !dc && !df) return false
  pushItem(s, iso, { n: 'Düzeltme', x: 1, p: dp, c: dc, f: df }, now)
  return true
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

// The day's meals, in order, for the day view.
export function mealsOf(day) {
  const items = Array.isArray(day?.items) ? day.items : []
  return MEALS.map(([k, label]) => ({ key: k, label, items: items.filter(it => !it.x && (it.m || 's') === k) }))
    .concat([{ key: 'x', label: 'Düzeltmeler', items: items.filter(it => it.x) }])
    .filter(g => g.items.length)
}
export const signedSum = items => items.reduce((a, it) => ({ p: a.p + signed(it.p), c: a.c + signed(it.c), f: a.f + signed(it.f) }), { p: 0, c: 0, f: 0 })
