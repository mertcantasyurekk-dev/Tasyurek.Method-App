// Taşyürek Method: body measurements — the tracker's ten tape measurements, kept by date.
//
// S.measurements = [{ d: 'YYYY-MM-DD', shoulder, chest, armL, armR, waistUpper, waistNavel, waistLower,
//                     hips, legL, legR, t, del? }]
// One entry per day (entering again the same day updates it); any subset of fields may be filled.
// A removed day stays as { d, del: true, t } so a sync with another device does not bring it back.
// Field keys are the tracker's, so its data comes over as is and the 360° export reads the same.

export const FIELDS = [
  { key: 'shoulder', label: 'Omuz', short: 'omuz', hint: 'Omuzların en geniş yerinden, kollar yanda' },
  { key: 'chest', label: 'Göğüs', short: 'göğüs', hint: 'Meme ucu hizasından, nefes normal' },
  { key: 'armL', label: 'Sol kol', short: 'sol kol', hint: 'Pazının en kalın yerinden, gevşek' },
  { key: 'armR', label: 'Sağ kol', short: 'sağ kol', hint: 'Pazının en kalın yerinden, gevşek' },
  { key: 'waistUpper', label: 'Bel (üst)', short: 'bel-üst', hint: 'Göbeğin ~5 cm üstünden' },
  { key: 'waistNavel', label: 'Bel (göbek)', short: 'bel-göbek', hint: 'Tam göbek hizasından, nefes verilmiş' },
  { key: 'waistLower', label: 'Bel (alt)', short: 'bel-alt', hint: 'Göbeğin ~5 cm altından' },
  { key: 'hips', label: 'Kalça', short: 'kalça', hint: 'Kalçanın en geniş yerinden' },
  { key: 'legL', label: 'Sol bacak', short: 'sol bacak', hint: 'Uyluğun en kalın yerinden' },
  { key: 'legR', label: 'Sağ bacak', short: 'sağ bacak', hint: 'Uyluğun en kalın yerinden' }
]
export const DUE_DAYS = 7

const num = v => { const x = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(x) ? x : NaN }
const ok = v => { const x = num(v); return x >= 10 && x <= 250 }          // cm, sane for a tape measure
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

// Live entries, oldest first.
export function entriesOf(S) {
  return (Array.isArray(S?.measurements) ? S.measurements : [])
    .filter(m => m && isDate(m.d) && !m.del && FIELDS.some(f => ok(m[f.key])))
    .sort((a, b) => (a.d < b.d ? -1 : 1))
}
export const latestOf = S => { const e = entriesOf(S); return e[e.length - 1] || null }

// The last value of each field up to (and including) an entry — a partial entry still shows
// the whole body, each field from when it was last measured.
export function valuesAt(entries, uptoD) {
  const out = {}
  for (const m of entries) {
    if (m.d > uptoD) break
    for (const f of FIELDS) if (ok(m[f.key])) out[f.key] = { v: num(m[f.key]), d: m.d }
  }
  return out
}

// Per field: now, and the change against the previous measurement of that field and the first one.
export function changesOf(S) {
  const e = entriesOf(S)
  if (!e.length) return null
  const out = {}
  for (const f of FIELDS) {
    const vals = e.filter(m => ok(m[f.key])).map(m => ({ d: m.d, v: num(m[f.key]) }))
    if (!vals.length) continue
    const last = vals[vals.length - 1], prev = vals[vals.length - 2], first = vals[0]
    out[f.key] = {
      v: last.v, d: last.d,
      dPrev: prev ? Math.round((last.v - prev.v) * 10) / 10 : null,
      dFirst: vals.length > 1 ? Math.round((last.v - first.v) * 10) / 10 : null,
      firstD: first.d
    }
  }
  return out
}

export function daysSinceLast(S, today) {
  const l = latestOf(S)
  if (!l) return null
  return Math.round((new Date(today + 'T12:00:00') - new Date(l.d + 'T12:00:00')) / 86400000)
}
export const isDue = (S, today) => { const n = daysSinceLast(S, today); return n === null || n >= DUE_DAYS }

export const seriesOf = (S, key) => entriesOf(S).filter(m => ok(m[key])).map(m => ({ d: m.d, t: new Date(m.d + 'T12:00:00').getTime(), y: num(m[key]) }))

/* ---- edits: call inside store.update(s => …) ---- */

// Save a day's measurements (only the fields given with sane values). Returns false if none.
export function saveMeasurement(s, d, values, now = Date.now()) {
  if (!isDate(d)) return false
  const clean = {}
  for (const f of FIELDS) if (ok(values?.[f.key])) clean[f.key] = Math.round(num(values[f.key]) * 10) / 10
  if (!Object.keys(clean).length) return false
  s.measurements = (Array.isArray(s.measurements) ? s.measurements : []).filter(m => m && m.d !== d)
  s.measurements.push({ d, ...clean, t: now })
  s.measurements.sort((a, b) => (a.d < b.d ? -1 : 1))
  return true
}
export function removeMeasurement(s, d, now = Date.now()) {
  s.measurements = (Array.isArray(s.measurements) ? s.measurements : []).filter(m => m && m.d !== d)
  s.measurements.push({ d, del: true, t: now })
  s.measurements.sort((a, b) => (a.d < b.d ? -1 : 1))
}

/* ---- sync ---- */

// Per day, the version written last (a removal is a version too).
export function mergeMeasurements(a, b) {
  const by = new Map()
  for (const m of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    if (!m || !isDate(m.d)) continue
    const cur = by.get(m.d)
    if (!cur || (Number(m.t) || 0) > (Number(cur.t) || 0)) by.set(m.d, m)
  }
  return [...by.values()].sort((x, y) => (x.d < y.d ? -1 : 1)).map(m => ({ ...m }))
}

/* ---- the 360° export line, as the tracker wrote it ---- */

export function measureLine(m) {
  if (!m) return '—'
  const parts = FIELDS.filter(f => ok(m[f.key])).map(f => `${f.short} ${Math.round(num(m[f.key]) * 10) / 10}`)
  return parts.length ? parts.join(' | ') : '—'
}
// The last measurement taken within some dates (the tracker's rule for a period).
export function lastInPeriod(S, dates) {
  const set = new Set(dates)
  const inside = entriesOf(S).filter(m => set.has(m.d))
  return inside[inside.length - 1] || null
}

// From the tracker's payload.measurements ({ id, date, shoulder, … }).
export function fromTracker(list) {
  return (Array.isArray(list) ? list : []).map(m => {
    const d = typeof m?.date === 'string' ? m.date.slice(0, 10) : null
    if (!isDate(d)) return null
    const e = { d }
    for (const f of FIELDS) if (ok(m[f.key])) e[f.key] = Math.round(num(m[f.key]) * 10) / 10
    return Object.keys(e).length > 1 ? e : null
  }).filter(Boolean)
}
