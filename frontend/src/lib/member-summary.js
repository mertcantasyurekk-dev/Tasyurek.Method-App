// Taşyürek Method: a member at a glance, for the coach. Every save writes a small summary next to
// the member's state (ogstate/{uid}.summary, ~1 KB): the last three weeks day by day, and the last
// dates of each kind of entry. The coach panel reads only these, never the whole state — so it opens
// fast however many members there are — and works out everything for the day the coach looks.
import { totalsOf } from './nutrition-core.js'
import { cardioOf, workoutCardio, isCardioOnly } from './daily.js'
import { entriesOf as measurementsOf } from './measurements.js'

const DAYS = 21
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d) }
const diffDays = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000)
const maxDate = list => list.filter(Boolean).reduce((m, d) => (!m || d > m ? d : m), null)

export function buildSummary(S, today = iso(new Date())) {
  const days = {}
  const from = addDays(today, -(DAYS - 1))
  const put = (d, k, v) => { if (d >= from && d <= today) (days[d] = days[d] || {})[k] = v }
  for (const w of S?.workouts || []) if (w?.d && !isCardioOnly(S, w)) put(w.d, 'w', ((days[w.d] || {}).w || 0) + 1)
  for (let i = 0; i < DAYS; i++) {
    const d = addDays(today, -i)
    const cm = cardioOf(S, d).reduce((a, x) => a + (Number(x.min) || 0), 0) + workoutCardio(S, d).min
    if (cm) put(d, 'c', Math.round(cm))
    const t = totalsOf(S?.nutrition?.[d])
    if (t.kcal > 0) { put(d, 'k', t.kcal); put(d, 'p', Math.round(t.p)) }
  }
  for (const b of S?.bodyweight || []) if (b?.d && b.w) put(b.d, 'bw', b.w)
  const lastWorkout = maxDate((S?.workouts || []).map(w => w?.d))
  const lastWeighIn = maxDate((S?.bodyweight || []).map(b => b?.d))
  const lastLog = maxDate(Object.entries(S?.nutrition || {}).filter(([, v]) => totalsOf(v).kcal > 0).map(([d]) => d))
  const lastMeasurement = maxDate(measurementsOf(S || {}).map(m => m.d))
  const lastCardio = maxDate(Object.entries(S?.cardio || {}).filter(([, v]) => (v?.items || []).length).map(([d]) => d))
  const lastBw = (S?.bodyweight || []).filter(b => b?.d === lastWeighIn)[0]
  return { v: 1, at: today, weekStart: S?.weekStart === 0 ? 0 : 1, days, lastWorkout, lastWeighIn, lastWeight: lastBw ? lastBw.w : null,
    lastLog, lastMeasurement, lastActive: maxDate([lastWorkout, lastWeighIn, lastLog, lastCardio]) }
}

// Everything the panel shows, for the day the coach is looking.
export function statsOf(sum, today = iso(new Date())) {
  if (!sum) return null
  const day = d => sum.days?.[d] || {}
  const ws = new Date(today + 'T12:00:00'); ws.setDate(ws.getDate() - ((ws.getDay() - (sum.weekStart ?? 1) + 7) % 7))
  const weekFrom = iso(ws)
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekFrom, i))
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, -i))
  const logged = Array.from({ length: 7 }, (_, i) => addDays(today, -1 - i)).filter(d => day(d).k)   // yesterday back
  const p3 = logged.slice(0, 3).map(d => day(d).p)
  const since = d => (d ? diffDays(d, today) : null)
  return {
    workoutsWeek: week.reduce((a, d) => a + (day(d).w || 0), 0),
    workouts7: last7.reduce((a, d) => a + (day(d).w || 0), 0),
    cardioWeek: week.reduce((a, d) => a + (day(d).c || 0), 0),
    daysLeftInclToday: week.filter(d => d >= today).length,
    logDays7: last7.filter(d => day(d).k).length,
    proteinAvg3: p3.length >= 2 ? Math.round(p3.reduce((a, b) => a + b, 0) / p3.length) : null,
    lastWorkout: sum.lastWorkout, lastWeight: sum.lastWeight, lastWeighIn: sum.lastWeighIn,
    sinceActive: since(sum.lastActive), sinceWeighIn: since(sum.lastWeighIn), sinceMeasurement: since(sum.lastMeasurement),
    measuredEver: !!sum.lastMeasurement
  }
}

// What deserves the coach's eye, most pressing first. level: 3 act now · 2 look · 1 note.
export function attentionOf({ joined, planAt, stats, targets }) {
  const out = []
  if (!joined) return [{ key: 'not-joined', level: 1, text: 'Yeni uygulamayı açmadı' }]
  if (!planAt) out.push({ key: 'no-plan', level: 2, text: 'Program atanmamış' })
  if (!stats) return out
  if (stats.sinceActive === null || stats.sinceActive >= 3) out.push({ key: 'inactive', level: 3, text: stats.sinceActive === null ? 'Hiç kayıt yok' : `${stats.sinceActive} gündür kayıt yok` })
  const want = targets?.workoutsPerWeek || 0
  if (want && want - stats.workoutsWeek > stats.daysLeftInclToday) out.push({ key: 'week-behind', level: 3, text: `Haftalık hedefe yetişemiyor (${stats.workoutsWeek}/${want})` })
  else if (want && want - stats.workoutsWeek === stats.daysLeftInclToday && stats.workoutsWeek < want) out.push({ key: 'week-tight', level: 2, text: `Hafta sıkışık (${stats.workoutsWeek}/${want}, ${stats.daysLeftInclToday} gün)` })
  const tp = Math.min(...[targets?.training?.p, targets?.rest?.p].filter(x => x > 0))
  if (isFinite(tp) && stats.proteinAvg3 !== null && stats.proteinAvg3 < tp * 0.85) out.push({ key: 'protein', level: 2, text: `Protein düşük (ort. ${stats.proteinAvg3}/${tp} g)` })
  if (stats.sinceActive !== null && stats.sinceActive < 3 && stats.logDays7 <= 3) out.push({ key: 'sparse-log', level: 2, text: `Beslenme kaydı seyrek (${stats.logDays7}/7 gün)` })
  if (stats.sinceWeighIn !== null && stats.sinceWeighIn >= 4) out.push({ key: 'weigh-in', level: 2, text: `${stats.sinceWeighIn} gündür tartılmadı` })
  if (stats.measuredEver && stats.sinceMeasurement >= 10) out.push({ key: 'measure', level: 1, text: `Ölçüm ${stats.sinceMeasurement} gündür yok` })
  return out.sort((a, b) => b.level - a.level)
}
export const attentionScore = list => list.reduce((a, x) => a + x.level * x.level, 0)
