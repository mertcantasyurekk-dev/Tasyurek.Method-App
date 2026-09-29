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
// Cardio and measurements stay in the tracker for now.
//
// Exercise names: only a name that IS a library name (the tracker's Program Editor adds exercises
// from the same 1324-exercise dataset) is linked to the library. Anything else becomes a custom
// exercise under the coach's own wording. A fuzzy match would be faster, but a wrong one files
// a lift's whole history and PRs under a different exercise — silently, and hard to undo.

import { CATALOGUE } from './exercises.js'
import { bpFromName, mergeImport } from './import-csv.js'
import { uid } from './format.js'
import { totalsOf } from './nutrition.js'

const clean = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
let byName = null
const libraryId = name => {
  if (!byName) { byName = new Map(); CATALOGUE.forEach(e => { if (!byName.has(clean(e.n))) byName.set(clean(e.n), e.id) }) }
  return byName.get(clean(name)) || null
}

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
export function convertTracker(payload, existingCustom = [], { stableIds = false } = {}) {
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
  const workouts = (Array.isArray(payload?.workouts) ? payload.workouts : []).map(w => {
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
    return {
      id: 'tt' + uid(), d, start, end: start, routineId: null,
      name: String(w.label || '').trim() || 'Antrenman', entries, prs: [],
      vol: entries.reduce((a, e) => a + e.sets.reduce((b, s) => b + s.w * s.r, 0), 0)
    }
  }).filter(Boolean).sort((a, b) => (a.d < b.d ? -1 : 1))

  // Daily weights.
  const bodyweight = Object.entries(payload?.daily || {})
    .map(([d, day]) => ({ d: isoDate(d), w: Math.round(num(day?.weight) * 10) / 10 }))
    .filter(b => b.d && b.w > 20 && b.w < 400)
    .sort((a, b) => (a.d < b.d ? -1 : 1))
    .map(b => ({ ...b, t: new Date(b.d + 'T08:00:00').getTime() }))

  // Daily macros, water, sleep: one item per day under a fixed id, so importing again adds nothing twice.
  const nutrition = Object.entries(payload?.daily || {}).map(([d, day]) => {
    if (!isoDate(d) || !day) return null
    const p = num(day.protein), c = num(day.carbs), f = num(day.fat)
    const water = num(day.water), sleep = num(day.sleep)
    if (!(p || c || f || water || sleep)) return null
    return { d, item: p || c || f ? { id: 'tt-' + d, name: 'Tracker', p: Math.round(p * 10) / 10, c: Math.round(c * 10) / 10, f: Math.round(f * 10) / 10, t: new Date(d + 'T20:00:00').getTime() } : null,
      water: water > 0 && water <= 15 ? water : 0, sleep: sleep > 0 && sleep <= 24 ? sleep : 0 }
  }).filter(Boolean).sort((a, b) => (a.d < b.d ? -1 : 1))

  // Custom exercises this import actually uses, that the profile does not have yet.
  const used = new Set([...routines.flatMap(r => r.ex.map(e => e.id)), ...workouts.flatMap(w => w.entries.map(e => e.id))])
  const customEx = fresh.filter(c => used.has(c.id))

  return { routines, workouts, bodyweight, nutrition, customEx, linked, programName: program?.name || '' }
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
  const w = mergeImport(S, { kind: 'workouts', workouts: conv.workouts, customEx: [] })
  const b = mergeImport(S, { kind: 'bodyweight', bodyweight: conv.bodyweight })
  // Nutrition: the tracker's day totals, where this app has nothing of its own for that field.
  let days = 0
  S.nutrition = S.nutrition && typeof S.nutrition === 'object' ? S.nutrition : {}
  for (const n of conv.nutrition || []) {
    const day = S.nutrition[n.d] && typeof S.nutrition[n.d] === 'object' ? S.nutrition[n.d] : {}
    let touched = false
    // The tracker's totals go in only where this app has none of its own for the day.
    if (n.item && totalsOf(day).kcal === 0) { day.p = n.item.p; day.c = n.item.c; day.f = n.item.f; delete day.items; delete day.del; touched = true }
    if (n.water && !day.water) { day.water = n.water; touched = true }
    if (n.sleep && !day.sleep) { day.sleep = n.sleep; touched = true }
    if (touched) { day._ts = Date.now(); S.nutrition[n.d] = day; days++ }
  }
  S.trackerImport = { at: now, ...(first ? {} : { firstAt: S.trackerImport.firstAt || S.trackerImport.at }) }
  return { routines, workouts: w.added, workoutsSkipped: w.skipped, weights: b.added, days, customs: conv.customEx.length }
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
