// Taşyürek Method: restoring from a backup — add-only. A record comes back only where the profile
// has nothing for it: a workout whose id is not there, a weigh-in, nutrition day, measurement day,
// supplement day or day note whose date is not there, a cardio item whose id is not there. Nothing
// already in the profile is overwritten or removed. A measurement day or cardio item the member
// deleted on purpose (its deletion mark is still there) stays deleted. Applying the same restore
// twice adds nothing the second time.
//
// The coach cannot write a member's ogstate (rules), so a member's records travel through
// restore/{uid}: the coach writes what is missing, the member's own app adds it and deletes the
// request (components/Restore.jsx). The coach's own profile is restored on the spot.
import { inUnitOf } from './sync-merge.js'
import { KIND_KEYS, emptyRestore } from './restore-core.js'
export { KINDS, KIND_KEYS, emptyRestore, countOf, totalOf, combine, COACH_PARTS, coachPartsIn } from './restore-core.js'

const list = v => (Array.isArray(v) ? v : [])
const map = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
const clone = o => JSON.parse(JSON.stringify(o))
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const workoutKey = w => (w?.id != null ? String(w.id) : `${w?.d}|${w?.start}`)


// What `backup` (a state) has that `cur` (a state) lacks, kind by kind.
export function missingFrom(backup, cur) {
  if (!backup) return emptyRestore()
  if (cur && backup.unit && cur.unit && backup.unit !== cur.unit) backup = inUnitOf(backup, cur)
  cur = cur || {}
  const out = emptyRestore()

  const have = new Set(list(cur.workouts).map(workoutKey))
  // `seen` sets grow as records are taken, so a list that holds the same record twice gives it once.
  const once = (set, k) => (set.has(k) ? false : (set.add(k), true))
  out.workouts = list(backup.workouts).filter(w => w && w.d && once(have, workoutKey(w))).map(clone)

  const bwDays = new Set(list(cur.bodyweight).map(b => b?.d))
  out.bodyweight = list(backup.bodyweight).filter(b => b && isDate(b.d) && b.w > 0 && once(bwDays, b.d)).map(clone)

  const nut = map(cur.nutrition)
  for (const [d, day] of Object.entries(map(backup.nutrition))) if (isDate(d) && day && !nut[d]) out.nutrition[d] = clone(day)

  const mDays = new Set(list(cur.measurements).map(m => m?.d))   // deleted days too: their mark stays
  out.measurements = list(backup.measurements).filter(m => m && isDate(m.d) && !m.del && once(mDays, m.d)).map(clone)

  const cc = map(cur.cardio)
  for (const [d, day] of Object.entries(map(backup.cardio))) {
    if (!isDate(d)) continue
    const known = new Set([...list(cc[d]?.items).map(i => i?.id), ...list(cc[d]?.del)])
    const items = list(day?.items).filter(i => i?.id && !list(day?.del).includes(i.id) && once(known, i.id))
    if (items.length) out.cardio[d] = { items: clone(items) }
  }

  const sp = map(cur.supps)
  for (const [d, day] of Object.entries(map(backup.supps))) if (isDate(d) && day && Object.keys(map(day.on)).length && !sp[d]) out.supps[d] = { on: clone(day.on) }

  const dn = map(cur.dayNotes)
  for (const [d, n] of Object.entries(map(backup.dayNotes))) if (isDate(d) && n?.text && !dn[d]) out.dayNotes[d] = clone(n)

  return out
}

// Only the chosen kinds.
export function pick(r, kinds) {
  const out = emptyRestore()
  for (const k of kinds || []) if (KIND_KEYS.includes(k) && r?.[k]) out[k] = clone(r[k])
  return out
}

// Adds `r` to the state `s` (mutates; for useStore's update). Re-checks against what `s` holds
// now, so a request applied twice — or after the member logged the same day meanwhile — adds
// nothing twice. Returns how many records were added.
export function applyRestore(s, r, now = Date.now()) {
  const add = missingFrom(fill(r), s)
  let n = 0
  if (add.workouts.length) {
    s.workouts = [...list(s.workouts), ...add.workouts]
    s.workouts.sort((a, b) => (a.d === b.d ? (a.start || 0) - (b.start || 0) : a.d < b.d ? -1 : 1))
    n += add.workouts.length
  }
  if (add.bodyweight.length) {
    s.bodyweight = [...list(s.bodyweight), ...add.bodyweight].sort((a, b) => (a.d < b.d ? -1 : 1))
    n += add.bodyweight.length
  }
  for (const [d, day] of Object.entries(add.nutrition)) {
    if (!s.nutrition || typeof s.nutrition !== 'object') s.nutrition = {}
    s.nutrition[d] = { ...day, _ts: now }
    n++
  }
  if (add.measurements.length) {
    s.measurements = [...list(s.measurements), ...add.measurements.map(m => ({ ...m, t: now }))].sort((a, b) => (a.d < b.d ? -1 : 1))
    n += add.measurements.length
  }
  for (const [d, day] of Object.entries(add.cardio)) {
    if (!s.cardio || typeof s.cardio !== 'object') s.cardio = {}
    const curDay = s.cardio[d] || { items: [] }
    s.cardio[d] = { ...curDay, items: [...list(curDay.items), ...day.items].sort((i, j) => (i.t || 0) - (j.t || 0)), _ts: now }
    n += day.items.length
  }
  for (const [d, day] of Object.entries(add.supps)) {
    if (!s.supps || typeof s.supps !== 'object') s.supps = {}
    s.supps[d] = { on: day.on, _ts: now }
    n++
  }
  for (const [d, note] of Object.entries(add.dayNotes)) {
    if (!s.dayNotes || typeof s.dayNotes !== 'object') s.dayNotes = {}
    s.dayNotes[d] = { ...note, t: now }
    n++
  }
  return n
}

// A restore request as a state-shaped object (missingFrom reads states).
const fill = r => ({ ...emptyRestore(), ...(r || {}), unit: r?.unit })

