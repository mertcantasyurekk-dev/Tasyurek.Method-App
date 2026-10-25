// Taşyürek Method: the small, import-free half of restoring from a backup (lib/restore.js has the
// rest). The Firebase adapter uses it, so it must not pull in the app's heavier modules.

const list = v => (Array.isArray(v) ? v : [])
const map = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})

export const KINDS = [
  { key: 'workouts', label: 'Antrenmanlar' },
  { key: 'bodyweight', label: 'Kilolar' },
  { key: 'nutrition', label: 'Beslenme günleri' },
  { key: 'measurements', label: 'Ölçüler' },
  { key: 'cardio', label: 'Kardiyo' },
  { key: 'supps', label: 'Takviye işaretleri' },
  { key: 'dayNotes', label: 'Günlük notlar' },
]
export const KIND_KEYS = KINDS.map(k => k.key)

export const emptyRestore = () => ({ workouts: [], bodyweight: [], nutrition: {}, measurements: [], cardio: {}, supps: {}, dayNotes: {} })


export function countOf(r) {
  const c = {}
  for (const k of KIND_KEYS) {
    const v = r?.[k]
    c[k] = Array.isArray(v) ? v.length : k === 'cardio' ? Object.values(map(v)).reduce((a, d) => a + list(d.items).length, 0) : Object.keys(map(v)).length
  }
  return c
}
export const totalOf = r => Object.values(countOf(r)).reduce((a, n) => a + n, 0)

// Two requests waiting for the same member, as one (the earlier first; applyRestore drops doubles).
export function combine(a, b) {
  const out = emptyRestore()
  for (const k of KIND_KEYS) {
    if (Array.isArray(out[k])) out[k] = [...list(a?.[k]), ...list(b?.[k])]
    else if (k === 'cardio') {
      for (const src of [a?.cardio, b?.cardio]) for (const [d, day] of Object.entries(map(src))) out.cardio[d] = { items: [...list(out.cardio[d]?.items), ...list(day?.items)] }
    } else out[k] = { ...map(b?.[k]), ...map(a?.[k]) }
  }
  out.unit = a?.unit || b?.unit
  return out
}

// The coach's side of a backup for one member: which coachplan / coachnotes fields it holds.
export const COACH_PARTS = [
  { key: 'plan', label: 'Program', doc: 'coachplan', fields: ['plan', 'planAt'] },
  { key: 'targets', label: 'Hedefler', doc: 'coachplan', fields: ['targets'] },
  { key: 'reviews', label: 'Koç mesajları', doc: 'coachplan', fields: ['reviews'] },
  { key: 'supplements', label: 'Takviye listesi', doc: 'coachplan', fields: ['supplements'] },
  { key: 'membership', label: 'Üyelik tarihleri', doc: 'coachplan', fields: ['membership'] },
  { key: 'notes', label: 'Koç notu, hedef ve raporlar', doc: 'coachnotes', fields: ['note', 'goal', 'reports'] },
]
const has = f => f && !('nullValue' in f) && !(f.stringValue === '' || f.stringValue === 'null' || f.stringValue === '[]')
export function coachPartsIn(planFields, noteFields) {
  return COACH_PARTS.filter(p => p.fields.some(f => has((p.doc === 'coachplan' ? planFields : noteFields)?.[f])))
}
