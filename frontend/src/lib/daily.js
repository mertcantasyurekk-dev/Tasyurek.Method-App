// Taşyürek Method: cardio, supplements and the week's progress against the coach's weekly targets.
//
// S.cardio = { 'YYYY-MM-DD': { items: [{ id, type, min, t }], del: [id], _ts } }
//   type is the tracker's own value ("Walking", "HIIT"…) so its history comes over as is.
// S.supps  = { 'YYYY-MM-DD': { on: { <itemId>: true }, _ts } }  — what was taken that day
// The coach's side (read-only for a member, from coachplan): S.coachSupplements = [{ id, label,
// items: [{ id, name, dose }] }] (the tracker's customSupplements shape), and the weekly targets in
// S.coachTargets: { workoutsPerWeek, cardioSessionsPerWeek, cardioMinutesPerWeek }.
import { uid } from './format.js'
import { EXIDX } from './exercises.js'
import { weekStartIso } from './nutrition-core.js'

export const CARDIO_TYPES = [
  ['Walking', 'Yürüyüş'], ['Incline Walk', 'Eğimli yürüyüş'], ['Running', 'Koşu'], ['Cycling', 'Bisiklet'],
  ['Elliptical', 'Eliptik'], ['Rowing', 'Kürek'], ['StairMaster', 'Merdiven'], ['Jump Rope', 'İp atlama'],
  ['Swimming', 'Yüzme'], ['HIIT', 'HIIT'], ['Other', 'Diğer']
]
export const cardioLabel = t => (CARDIO_TYPES.find(x => x[0] === t) || [null, t || 'Kardiyo'])[1]

const num = v => { const x = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(x) ? x : 0 }
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export const weekDays = (S, today) => { const a = weekStartIso(today, S?.weekStart === 0 ? 0 : 1); return Array.from({ length: 7 }, (_, i) => addDays(a, i)) }

/* ---- cardio ---- */

export const cardioOf = (S, iso) => { const d = S?.cardio?.[iso]; return d && Array.isArray(d.items) ? d.items : [] }

export function addCardio(s, iso, { type, min }, now = Date.now()) {
  const m = Math.round(num(min))
  if (!isDate(iso) || !(m > 0 && m <= 600)) return null
  if (!s.cardio || typeof s.cardio !== 'object') s.cardio = {}
  const d = s.cardio[iso] && typeof s.cardio[iso] === 'object' ? s.cardio[iso] : {}
  d.items = Array.isArray(d.items) ? d.items : []
  const it = { id: 'c' + uid(), type: type || 'Other', min: m, t: now }
  d.items.push(it); d._ts = now
  s.cardio[iso] = d
  return it
}
export function removeCardio(s, iso, id, now = Date.now()) {
  const d = s.cardio?.[iso]
  if (!d) return
  d.items = (d.items || []).filter(x => x.id !== id)
  d.del = [...new Set([...(d.del || []), id])]
  d._ts = now
}

// Cardio done inside a logged workout (an openGym cardio exercise), in minutes, per day.
export function workoutCardio(S, iso) {
  let sessions = 0, min = 0
  for (const w of S?.workouts || []) {
    if (w?.d !== iso) continue
    let had = false
    for (const e of w.entries || []) {
      const bp = EXIDX[e?.id]?.bp || (S.customEx || []).find(c => c.id === e?.id)?.bp
      if (bp !== 'cardio') continue
      const sec = (e.sets || []).filter(x => x && x.done !== false).reduce((a, x) => a + (num(x.sec) || num(x.t) || 0), 0)
      if (sec > 0 || (e.sets || []).some(x => x?.done)) { had = true; min += sec / 60 }
    }
    if (had) sessions++
  }
  return { sessions, min }
}

/* ---- the week ---- */

export function weekProgress(S, today) {
  const days = weekDays(S, today)
  const T = S?.coachTargets || S?.myTargets || {}
  let workouts = 0, sessions = 0, minutes = 0
  const perDay = []
  for (const d of days) {
    const dw = (S?.workouts || []).filter(w => w?.d === d && !isCardioOnly(S, w)).length
    const log = cardioOf(S, d)
    const wc = workoutCardio(S, d)
    const ds = log.length + wc.sessions, dm = log.reduce((a, x) => a + num(x.min), 0) + wc.min
    workouts += dw; sessions += ds; minutes += dm
    perDay.push({ d, workouts: dw, sessions: ds, minutes: Math.round(dm), today: d === today, future: d > today })
  }
  const daysLeft = days.filter(d => d > today).length
  return {
    days, perDay, daysLeft, workouts, sessions, minutes: Math.round(minutes),
    targets: { workouts: num(T.workoutsPerWeek) || 0, sessions: num(T.cardioSessionsPerWeek) || 0, minutes: num(T.cardioMinutesPerWeek) || 0 }
  }
}
// A workout that is only cardio does not count as a training session.
export function isCardioOnly(S, w) {
  const es = (w?.entries || []).filter(e => e?.id)
  return es.length > 0 && es.every(e => (EXIDX[e.id]?.bp || (S.customEx || []).find(c => c.id === e.id)?.bp) === 'cardio')
}

/* ---- supplements ---- */

// The coach's list for a member; the coach's own list (S.mySupplements) for the coach.
export const supplementPlan = S => (Array.isArray(S?.coachSupplements) ? S.coachSupplements : Array.isArray(S?.mySupplements) ? S.mySupplements : []).filter(g => g && Array.isArray(g.items) && g.items.length)
export const suppItems = S => supplementPlan(S).flatMap(g => g.items.filter(i => i && i.id))
export const takenOn = (S, iso) => (S?.supps?.[iso]?.on && typeof S.supps[iso].on === 'object' ? S.supps[iso].on : {})

export function toggleSupp(s, iso, itemId, now = Date.now()) {
  if (!s.supps || typeof s.supps !== 'object') s.supps = {}
  const d = s.supps[iso] && typeof s.supps[iso] === 'object' ? s.supps[iso] : { on: {} }
  d.on = { ...(d.on || {}) }
  if (d.on[itemId]) delete d.on[itemId]; else d.on[itemId] = true
  d._ts = now
  s.supps[iso] = d
}

// Share of the plan's items taken over the last n days. Today counts only once something is ticked
// (the day is not over) — unless countToday, for a week that is already over.
export function suppAdherence(S, today, n = 7, { countToday = false } = {}) {
  const items = suppItems(S)
  if (!items.length) return null
  let want = 0, got = 0
  for (let i = 0; i < n; i++) {
    const d = addDays(today, -i)
    const on = takenOn(S, d)
    if (i === 0 && !countToday && !Object.keys(on).length) continue
    want += items.length; got += items.filter(x => on[x.id]).length
  }
  return want ? Math.round((got / want) * 100) : null
}

/* ---- sync ---- */

// Cardio: per day, items from both copies minus deletions (as the nutrition log does this week).
export function mergeCardio(a, b) {
  const A = a && typeof a === 'object' ? a : {}, B = b && typeof b === 'object' ? b : {}
  const out = {}
  for (const iso of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const x = A[iso], y = B[iso]
    if (!x || !y) { out[iso] = JSON.parse(JSON.stringify(x || y)); continue }
    const del = new Set([...(x.del || []), ...(y.del || [])])
    const items = new Map()
    for (const it of [...(x.items || []), ...(y.items || [])]) if (it?.id && !del.has(it.id) && !items.has(it.id)) items.set(it.id, { ...it })
    out[iso] = { items: [...items.values()].sort((i, j) => (i.t || 0) - (j.t || 0)), ...(del.size ? { del: [...del] } : {}), _ts: Math.max(Number(x._ts) || 0, Number(y._ts) || 0) }
  }
  return out
}
// Supplements: per day, the copy ticked last.
export function mergeSupps(a, b) {
  const A = a && typeof a === 'object' ? a : {}, B = b && typeof b === 'object' ? b : {}
  const out = {}
  for (const iso of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const x = A[iso], y = B[iso]
    out[iso] = JSON.parse(JSON.stringify(!x ? y : !y ? x : (Number(y._ts) || 0) > (Number(x._ts) || 0) ? y : x))
  }
  return out
}

/* ---- from the tracker ---- */

// payload.daily[d].cardio = [{ id, type, duration }], payload.daily[d].supplements = { itemId: bool }
export function dailyFromTracker(payload) {
  const cardio = {}, supps = {}
  for (const [d, day] of Object.entries(payload?.daily || {})) {
    if (!isDate(d) || !day) continue
    const items = (Array.isArray(day.cardio) ? day.cardio : []).map((c, i) => ({ id: 'tt-' + d + '-' + (c?.id || i), type: c?.type || 'Other', min: Math.round(num(c?.duration)), t: new Date(d + 'T19:00:00').getTime() + i }))
      .filter(c => c.min > 0 && c.min <= 600)
    if (items.length) cardio[d] = { items, _ts: 1 }
    const on = Object.fromEntries(Object.entries(day.supplements || {}).filter(([, v]) => v === true))
    if (Object.keys(on).length) supps[d] = { on, _ts: 1 }
  }
  return { cardio, supps }
}

/* ---- the day's note (S.dayNotes[date] = { text, t }) ---- */

export const dayNoteOf = (S, iso) => (S?.dayNotes?.[iso]?.text || '')
export function setDayNote(s, iso, text, now = Date.now()) {
  if (!s.dayNotes || typeof s.dayNotes !== 'object') s.dayNotes = {}
  s.dayNotes[iso] = { text: String(text || '').slice(0, 2000), t: now }
}
// Per day, the note written last (an emptied note is a note too).
export function mergeDayNotes(a, b) {
  const A = a && typeof a === 'object' ? a : {}, B = b && typeof b === 'object' ? b : {}
  const out = {}
  for (const iso of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const x = A[iso], y = B[iso]
    out[iso] = { ...(!x ? y : !y ? x : (Number(y.t) || 0) > (Number(x.t) || 0) ? y : x) }
  }
  return out
}
