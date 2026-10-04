// Taşyürek Method: bring a member's history over from the old tracker (userdata/{uid}.payload).
//
// Read-only on the tracker's side: the payload is fetched with a field mask and never written.
// What comes over:
//   - the active program's days      → routines (only on the first import)
//   - workouts                        → workouts, through openGym's own mergeImport (a day that
//                                       already has a workout here is skipped, so importing twice
//                                       never duplicates anything)
//   - daily weights                   → body weight, through mergeImport as well
//   - daily macros, water and sleep    → S.nutrition day totals, where the app has none yet
//   - body measurements               → S.measurements (days this app has none for)
// Cardio stays in the tracker for now.
//
// Exercise names: only a name that IS a library name (the tracker's Program Editor adds exercises
// from the same 1324-exercise dataset) is linked to the library. Anything else becomes a custom
// exercise under the coach's own wording. A fuzzy match would be faster, but a wrong one files
// a lift's whole history and PRs under a different exercise — silently, and hard to undo.

import { CATALOGUE } from './exercises.js'
import { bpFromName, mergeImport } from './import-csv.js'
import { uid } from './format.js'
import { totalsOf } from './nutrition.js'
import { fromTracker as measurementsFromTracker } from './measurements.js'
import { dailyFromTracker } from './daily.js'

const clean = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
let byName = null
const libraryId = name => {
  if (!byName) { byName = new Map(); CATALOGUE.forEach(e => { if (!byName.has(clean(e.n))) byName.set(clean(e.n), e.id) }) }
  return byName.get(clean(name)) || null
}

const isoOfDate = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0 }
const isoDate = s => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? s : null)

// "8-10" → { reps: 10, repsMin: 8 } (a range: double progression), "12" → { reps: 12 }.
export function parseReps(v) {
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d+)\s*[-–]\s*(\d+)$/)
  if (m) {
    const a = +m[1], b = +m[2]
    const lo = Math.min(a, b), hi = Math.max(a, b)
    return lo === hi ? { reps: hi } : { reps: hi, repsMin: lo }
  }
  m = s.match(/^(\d+)$/)
  return m && +m[1] > 0 ? { reps: +m[1] } : { reps: 10 }
}

/** Parse the tracker's payload (a JSON string, as stored) into a plain object, or null. */
export function readPayload(raw) {
  if (!raw) return null
  try { const p = typeof raw === 'string' ? JSON.parse(raw) : raw; return p && typeof p === 'object' ? p : null } catch { return null }
}

/**
 * Work out everything the import would add, without touching state.
 * `existingCustom` is the profile's S.customEx: a name already there is reused, not duplicated.
 */
// The import's version. Raise it whenever the import learns to bring something new: a profile
// imported by an older version is imported again on its next start (autoImportFromTracker), which is
// safe — workouts merge by id, days and entries already here win — and brings the new kinds over.
// 1: workouts, weights, programs, nutrition totals · 2: + measurements, cardio, supplements, notes,
// durations, day types, this week's meals, prior bests, id-based workout merge.
export const IMPORT_VERSION = 2
export const importOutdated = S => !S?.trackerImport || (Number(S.trackerImport.v) || 1) < IMPORT_VERSION

export function convertTracker(payload, existingCustom = [], { stableIds = false, timers = null, mealLog = null, today = null } = {}) {
  const custom = new Map()   // clean name -> custom exercise (existing or new)
  existingCustom.forEach(c => { if (c && c.n) custom.set(clean(c.n), c) })
  const fresh = []
  let linked = 0
  const exId = name => {
    const n = String(name || '').trim()
    if (!n) return null
    const lib = libraryId(n)
    if (lib) { linked++; return lib }
    let c = custom.get(clean(n))
    if (!c) {
      c = { id: 'tt' + uid(), n, custom: true, eq: 'custom', tg: '', desc: '', bp: bpFromName(n.toLowerCase()) || 'upper legs' }
      custom.set(clean(n), c); fresh.push(c)
    }
    return c.id
  }

  // Program → routines. The active one only: that is what the member trains now.
  const programs = Array.isArray(payload?.programs) ? payload.programs : []
  const program = programs.find(p => p && p.id === payload.activeProgramId) || programs[0] || null
  const slug = v => String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)
  const routines = (program?.days || []).filter(d => d && Array.isArray(d.exercises)).map((day, di) => {
    const ex = day.exercises.map(e => {
      const id = exId(e?.name)
      if (!id) return null
      const r = parseReps(e.reps)
      const note = [e.rir !== undefined && e.rir !== '' ? 'RIR ' + e.rir : '', String(e.note || '').trim()].filter(Boolean).join(' · ').slice(0, 500)
      const warm = Math.min(5, Math.max(0, Math.round(num(e.warmupSets))))
      return {
        id, sets: Math.max(1, Math.round(num(e.sets)) || 3), ...r, weight: 0,
        ...(r.repsMin ? { prog: 'double' } : {}),
        ...(note ? { note } : {}),
        ...(warm ? { warmupSets: warm } : {})
      }
    }).filter(Boolean)
    const label = String(day.label || '').trim() || 'Antrenman'
    const focus = String(day.focus || '').trim()
    // The coach's transfer uses ids that stay the same each time, so doing it again updates the same
    // routines (and the member's history stays attached to them).
    const id = stableIds ? `tt-${slug(program.id) || 'p'}-${slug(day.id) || di}` : uid()
    return { id, name: focus ? `${label} — ${focus}` : label, emoji: 'barbell', ex }
  }).filter(r => r.ex.length)

  // Workouts, in the shape mergeImport takes.
  const workouts = (Array.isArray(payload?.workouts) ? payload.workouts : []).map((w, wi) => {
    const d = isoDate(w?.date)
    if (!d) return null
    const entries = (w.exercises || []).map(e => {
      const sets = (e?.sets || []).map(s => ({ w: num(s?.weight), r: Math.round(num(s?.reps)), done: true })).filter(s => s.r > 0 || s.w > 0)
      if (!sets.length) return null
      const id = exId(e.name)
      if (!id) return null
      const topW = Math.max(0, ...sets.map(s => s.w))
      return { id, sets, topW: topW || null }
    }).filter(Boolean)
    if (!entries.length) return null
    const start = new Date(d + 'T18:00:00').getTime()
    // The tracker's timer kept the session's length beside the payload (workoutTimers[date].totalSec).
    const sec = num(timers?.[d]?.totalSec)
    return {
      // The same tracker workout always gets the same id, so importing on two devices (or twice)
      // ends as one entry after sync, never two.
      id: 'tt-w-' + (w.id != null ? String(w.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) : d + '-' + wi), d, start, end: start + (sec > 0 && sec < 6 * 3600 ? Math.round(sec) * 1000 : 0), routineId: null,
      name: String(w.label || '').trim() || 'Antrenman', entries, prs: [],
      vol: entries.reduce((a, e) => a + e.sets.reduce((b, s) => b + s.w * s.r, 0), 0)
    }
  }).filter(Boolean).sort((a, b) => (a.d < b.d ? -1 : 1))

  // Daily weights.
  // A weight typed into the tracker's measurement form counts too, for days without a daily weight.
  const bwByDay = new Map()
  for (const m of Array.isArray(payload?.measurements) ? payload.measurements : []) {
    const d = isoDate(typeof m?.date === 'string' ? m.date.slice(0, 10) : null), w = Math.round(num(m?.weight) * 10) / 10
    if (d && w > 20 && w < 400) bwByDay.set(d, w)
  }
  for (const [d, day] of Object.entries(payload?.daily || {})) {
    const w = Math.round(num(day?.weight) * 10) / 10
    if (isoDate(d) && w > 20 && w < 400) bwByDay.set(d, w)
  }
  const bodyweight = [...bwByDay.entries()].map(([d, w]) => ({ d, w }))
    .sort((a, b) => (a.d < b.d ? -1 : 1))
    .map(b => ({ ...b, t: new Date(b.d + 'T08:00:00').getTime() }))

  // Daily macros, water, sleep, the day type picked by hand. Meals the tracker logged one by one
  // (mealLog) come as meals for the current week — where this app keeps them — and as day totals
  // before it, where the tracker had no day total of its own.
  const MEAL = { breakfast: 'b', lunch: 'l', dinner: 'd', snacks: 's' }
  const weekFrom = today ? (() => { const x = new Date(today + 'T12:00:00'); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return isoOfDate(x) })() : null
  const mealDays = mealLog && typeof mealLog === 'object' ? mealLog : {}
  const dayType = v => (v === 'training' ? 'training' : v === 'rest' || v === 'off' || v === 'offDay' ? 'rest' : null)
  const allDays = new Set([...Object.keys(payload?.daily || {}), ...Object.keys(mealDays), ...Object.keys(payload?.customDayTypeChoice || {})])
  const r1 = v => Math.round(v * 10) / 10
  const nutrition = [...allDays].filter(isoDate).map(d => {
    const day = payload?.daily?.[d] || {}
    const p = num(day.protein), c = num(day.carbs), f = num(day.fat)
    const water = num(day.water), sleep = num(day.sleep)
    const meals = []
    for (const [k, list] of Object.entries(mealDays[d] || {})) {
      ;(Array.isArray(list) ? list : []).forEach((e, i) => {
        const mp = num(e?.protein), mc = num(e?.carbs), mf = num(e?.fat)
        if (!(mp || mc || mf)) return
        meals.push({ id: `tt-m-${d}-${k}-${i}`, m: MEAL[k] || 's', n: String(e?.name || 'Yemek').slice(0, 80), q: r1(num(e?.qty)) || 1,
          u: e?.unit === '100g' ? 'g' : (e?.portionLabel || null), p: r1(mp), c: r1(mc), f: r1(mf), t: new Date(d + 'T12:00:00').getTime() + i })
      })
    }
    const mealSum = meals.reduce((a, x) => ({ p: a.p + x.p, c: a.c + x.c, f: a.f + x.f }), { p: 0, c: 0, f: 0 })
    const thisWeek = weekFrom && d >= weekFrom
    const type = dayType(payload?.customDayTypeChoice?.[d])
    const note = typeof day.notes === 'string' ? day.notes.trim().slice(0, 2000) : ''
    const totals = p || c || f ? { p: r1(p), c: r1(c), f: r1(f) } : mealSum.p || mealSum.c || mealSum.f ? { p: r1(mealSum.p), c: r1(mealSum.c), f: r1(mealSum.f) } : null
    if (!totals && !water && !sleep && !type && !note && !meals.length) return null
    return {
      d,
      // this week: the meals themselves (their sum is the day); earlier: the day's total
      items: thisWeek && meals.length ? meals : null,
      item: !(thisWeek && meals.length) && totals ? { id: 'tt-' + d, name: 'Tracker', ...totals, t: new Date(d + 'T20:00:00').getTime() } : null,
      water: water > 0 && water <= 15 ? water : 0, sleep: sleep > 0 && sleep <= 24 ? sleep : 0, type, note
    }
  }).filter(Boolean).sort((a, b) => (a.d < b.d ? -1 : 1))

  // Bests from before the tracker (priorBests: { exercise name: weight }): one marked session the day
  // before the first workout, so they stay in each lift's history and its records.
  const prior = Object.entries(payload?.priorBests && typeof payload.priorBests === 'object' ? payload.priorBests : {})
    .map(([name, w]) => ({ name, w: num(w) })).filter(x => x.name && x.w > 0)
  if (prior.length) {
    const firstD = workouts.length ? workouts[0].d : (today || isoOfDate(new Date()))
    const dd = (() => { const x = new Date(firstD + 'T12:00:00'); x.setDate(x.getDate() - 1); return isoOfDate(x) })()
    const entries = prior.map(x => ({ id: exId(x.name), sets: [{ w: x.w, r: 1, done: true }], topW: x.w, note: 'Tracker öncesi rekor' })).filter(e => e.id)
    if (entries.length) {
      const start = new Date(dd + 'T18:00:00').getTime()
      workouts.unshift({ id: 'tt-w-prior-bests', d: dd, start, end: start, routineId: null, name: 'Önceki rekorlar (tracker)', entries, prs: [], vol: 0 })
    }
  }

  // Custom exercises this import actually uses, that the profile does not have yet.
  const used = new Set([...routines.flatMap(r => r.ex.map(e => e.id)), ...workouts.flatMap(w => w.entries.map(e => e.id))])
  const customEx = fresh.filter(c => used.has(c.id))

  const measurements = measurementsFromTracker(payload?.measurements)
  const { cardio, supps } = dailyFromTracker(payload)
  return { routines, workouts, bodyweight, nutrition, measurements, cardio, supps, customEx, linked, programName: program?.name || '', priorBests: prior.length }
}

/**
 * Apply a conversion to a draft state (call inside store.update). Routines only come over the
 * first time; history and weights can be re-imported safely at any time (days already here win).
 */
export function applyTrackerImport(S, conv, { now = new Date().toISOString() } = {}) {
  S.customEx = [...(S.customEx || []), ...conv.customEx]
  const first = !S.trackerImport
  let routines = 0
  // A member the coach has given a program to trains that program: their tracker routines stay behind.
  if (first && conv.routines.length && !S.coachPlanAt) {
    S.routines = [...(S.routines || []), ...conv.routines]
    routines = conv.routines.length
  }
  S.workouts = S.workouts || []
  S.bodyweight = S.bodyweight || []
  S.exWeights = S.exWeights || {}
  // Tracker workouts go in by their own (stable) id, never by date: a day that also has a workout
  // logged in this app keeps both. (mergeImport skips any day that already has a workout — right for
  // a Hevy export, a loss here.)
  const haveIds = new Set(S.workouts.map(x => x?.id))
  // An earlier import (version 1) gave the same tracker workouts random ids: the same day, name and
  // volume already here is that workout, not a new one.
  const sameAs = x => S.workouts.some(y => y && y.d === x.d && (y.name || '') === (x.name || '') && Math.abs((Number(y.vol) || 0) - (Number(x.vol) || 0)) < 0.5
    && (y.entries || []).length === (x.entries || []).length)
  const freshW = conv.workouts.filter(x => !haveIds.has(x.id) && !sameAs(x))
  S.workouts = [...S.workouts, ...freshW].sort((a, b) => (a.d < b.d ? -1 : 1))
  freshW.forEach(x => x.entries.forEach(e => {
    const mx = Math.max(0, ...e.sets.map(z => z.w || 0), e.topW || 0)
    if (mx > 0 && x.id !== 'tt-w-prior-bests') { const cur = S.exWeights[e.id]; if (!cur || x.d >= cur.d) S.exWeights[e.id] = { w: mx, d: x.d } }
  }))
  const w = { added: freshW.length, skipped: conv.workouts.length - freshW.length }
  const b = mergeImport(S, { kind: 'bodyweight', bodyweight: conv.bodyweight })
  // Nutrition: the tracker's day totals, where this app has nothing of its own for that field.
  let days = 0
  S.nutrition = S.nutrition && typeof S.nutrition === 'object' ? S.nutrition : {}
  S.dayNotes = S.dayNotes && typeof S.dayNotes === 'object' ? S.dayNotes : {}
  for (const n of conv.nutrition || []) {
    const day = S.nutrition[n.d] && typeof S.nutrition[n.d] === 'object' ? S.nutrition[n.d] : {}
    let touched = false
    // Food goes in only where this app has none of its own for the day; never on top of it.
    if (totalsOf(day).kcal === 0) {
      if (n.items?.length) { day.items = n.items.map(x => ({ ...x })); delete day.del; touched = true }
      else if (n.item) { day.p = n.item.p; day.c = n.item.c; day.f = n.item.f; delete day.items; delete day.del; touched = true }
    }
    if (n.water && !day.water) { day.water = n.water; touched = true }
    if (n.sleep && !day.sleep) { day.sleep = n.sleep; touched = true }
    if (n.type && !day.type) { day.type = n.type; touched = true }
    if (touched) { day._ts = Date.now(); S.nutrition[n.d] = day; days++ }
    if (n.note && !S.dayNotes[n.d]) S.dayNotes[n.d] = { text: n.note, t: new Date(n.d + 'T21:00:00').getTime() }
  }

  // Body measurements: days this app has none for (never over one entered or removed here).
  let meas = 0
  const have = new Set((Array.isArray(S.measurements) ? S.measurements : []).map(m => m?.d))
  for (const m of conv.measurements || []) {
    if (have.has(m.d)) continue
    S.measurements = [...(S.measurements || []), { ...m, t: new Date(m.d + 'T09:00:00').getTime() }]
    meas++
  }
  if (meas) S.measurements.sort((a, b) => (a.d < b.d ? -1 : 1))
  // Cardio and supplement ticks: days this app has none of its own for.
  let cardioDays = 0
  S.cardio = S.cardio && typeof S.cardio === 'object' ? S.cardio : {}
  for (const [d, day] of Object.entries(conv.cardio || {})) { if (!S.cardio[d]) { S.cardio[d] = { ...day, items: day.items.map(x => ({ ...x })) }; cardioDays++ } }
  S.supps = S.supps && typeof S.supps === 'object' ? S.supps : {}
  for (const [d, day] of Object.entries(conv.supps || {})) if (!S.supps[d]) S.supps[d] = { on: { ...day.on }, _ts: day._ts }
  S.trackerImport = { at: now, v: IMPORT_VERSION, ...(first ? {} : { firstAt: S.trackerImport.firstAt || S.trackerImport.at }) }
  return { routines, workouts: w.added, workoutsSkipped: w.skipped, weights: b.added, days, measurements: meas, cardioDays, customs: conv.customEx.length }
}

// Days of the week for n routines in order, when the tracker had no weekday for them (openGym keys:
// 0 Sunday … 6 Saturday). A starting point; the coach moves days in the assignment sheet.
export function defaultWeek(ids) {
  const days = { 1: [1], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [1, 2, 3, 4, 5, 6, 0] }[Math.min(ids.length, 7)] || []
  const week = {}
  days.forEach((d, i) => { week[d] = [ids[i]] })
  return week
}

/**
 * The coach's side: the member's active tracker program as a plan for coachplan/{uid}.
 * `memberCustom` is the member's own customEx, so a custom exercise they already have (from their
 * history import) is reused by name and routine and history point at the same exercise.
 */
export function trackerPlan(payload, memberCustom = []) {
  const conv = convertTracker(payload, memberCustom, { stableIds: true })
  if (!conv.routines.length) return null
  const used = new Set(conv.routines.flatMap(r => r.ex.map(e => e.id)))
  const customEx = [...conv.customEx.filter(c => used.has(c.id)), ...memberCustom.filter(c => c && used.has(c.id) && !conv.customEx.some(x => x.id === c.id))]
  return { routines: conv.routines, week: defaultWeek(conv.routines.map(r => r.id)), customEx, programName: conv.programName }
}

/**
 * After the import: is everything from the tracker here? Per kind, how many of the tracker's
 * records this state holds. A day's food counts as here when the day has food of its own too.
 */
export function verifyImport(conv, S) {
  const has = (list, key) => new Set((list || []).map(key))
  const wIds = has(S?.workouts, w => w?.id)
  const bw = has(S?.bodyweight, b => b?.d)
  const meas = has((S?.measurements || []).filter(m => !m?.del), m => m?.d)
  const food = d => totalsOf(S?.nutrition?.[d]).kcal > 0
  const cardio = d => (S?.cardio?.[d]?.items || []).length > 0
  const nutDays = (conv.nutrition || []).filter(n => n.item || n.items?.length)
  const rows = [
    ['antrenman', conv.workouts.length, conv.workouts.filter(w => wIds.has(w.id) || (S?.workouts || []).some(y => y && y.d === w.d && (y.name || '') === (w.name || '')
      && Math.abs((Number(y.vol) || 0) - (Number(w.vol) || 0)) < 0.5)).length],
    ['kilo', conv.bodyweight.length, conv.bodyweight.filter(b => bw.has(b.d)).length],
    ['ölçüm', (conv.measurements || []).length, (conv.measurements || []).filter(m => meas.has(m.d)).length],
    ['beslenme günü', nutDays.length, nutDays.filter(n => food(n.d)).length],
    ['kardiyo günü', Object.keys(conv.cardio || {}).length, Object.keys(conv.cardio || {}).filter(cardio).length],
    ['günlük not', (conv.nutrition || []).filter(n => n.note).length, (conv.nutrition || []).filter(n => n.note && S?.dayNotes?.[n.d]?.text).length]
  ].filter(r => r[1] > 0)
  return { rows: rows.map(([label, want, got]) => ({ label, want, got, ok: got >= want })), ok: rows.every(r => r[2] >= r[1]) }
}
