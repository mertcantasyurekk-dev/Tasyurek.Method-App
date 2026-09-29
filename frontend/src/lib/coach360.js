// Taşyürek Method: the 360° weekly analysis, ported from the tracker (index.html tt360*).
// The text formats are unchanged — "=== TT-VERI v1 ===" out, "[[TT-REVIZE uid=… hafta=…]]" in — so
// the analysis prompt and habit that work today keep working. Only the source of the data changes:
// openGym's state (workouts, bodyweight), the nutrition log (day totals), the coach's plan and
// targets, and the coach's own notes.
//
// Periods are fixed calendar weeks: [N] = the Monday→Sunday week that ended on the last Sunday
// (today, if today is Sunday), [N-1] the week before it. The same week comes out whatever day
// the coach looks.
import { EXIDX } from './exercises.js'
import { isWarmupRow } from './workout-model.js'
import { totalsOf, kcalOf } from './nutrition-core.js'
import { macroTargetFor } from './nutrition.js'

const num = v => { if (v === null || v === undefined || v === '') return NaN; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? NaN : n }
const fmt = (n, d = 1) => (n === null || n === undefined || isNaN(n) ? '—' : String(Math.round(n * 10 ** d) / 10 ** d))
const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)
const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const parse = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d) }
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return isoOf(d) }
const range = (end, len) => Array.from({ length: len }, (_, i) => addDays(end, i - len + 1))
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

// The last Sunday (today, if Sunday).
export function weekEnd(today = isoOf(new Date())) {
  const d = parse(today); d.setDate(d.getDate() - d.getDay()); return isoOf(d)
}
export const weekWindow = (today) => { const N = range(weekEnd(today), 7); return { N, N1: range(addDays(N[0], -1), 7) } }

export const GOALS = ['Cut', 'Clean Bulk', 'Recomposition', 'Bakım', 'Podyum']

/* ---------------------------------------------------------------- export ------------------------ */

const nameOf = (id, S) => {
  const c = (S.customEx || []).find(x => x?.id === id)
  const n = c?.n || EXIDX[id]?.n || id
  return n.charAt(0).toLocaleUpperCase('tr') + n.slice(1)
}

// Sets that count: logged, not warm-ups, with reps.
function setsOf(entry) {
  return (entry?.sets || []).filter(s => s && s.done !== false && !isWarmupRow(s) && num(s.r) > 0)
    .map(s => ({ w: Math.max(0, num(s.w) || 0), r: num(s.r) }))
}
const isCardioEntry = (e, S) => (EXIDX[e?.id]?.bp || (S.customEx || []).find(c => c.id === e?.id)?.bp) === 'cardio'

function collectByExercise(workouts, S) {
  const map = {}
  for (const wk of workouts) {
    for (const e of wk.entries || []) {
      if (!e?.id || isCardioEntry(e, S)) continue
      const sets = setsOf(e)
      if (!sets.length) continue
      const m = map[e.id] || (map[e.id] = { name: nameOf(e.id, S), sets: [], best: null, bestDate: null, sessions: 0 })
      m.sessions++
      for (const s of sets) {
        m.sets.push(s)
        if (!m.best || s.w > m.best.w || (s.w === m.best.w && s.r > m.best.r)) { m.best = s; m.bestDate = wk.d }
      }
    }
  }
  return map
}
const workStats = m => ({ n: m.sets.length, ton: m.sets.reduce((a, s) => a + s.w * s.r, 0) })
function setLine(m, showWork) {
  const b = m.best
  const main = b.w > 0 ? `${fmt(b.w, 2)} x ${fmt(b.r, 0)}` : `vücut ağırlığı x ${fmt(b.r, 0)}`
  const extra = []
  if (b.w > 0 && b.r <= 12) extra.push('e1RM≈' + fmt(b.w * (1 + b.r / 30), 0))
  if (showWork) extra.push(workStats(m).n + ' set')
  if (m.bestDate) extra.push(String(m.bestDate).slice(showWork ? 5 : 0))
  return `  ${m.name}: ${main}${extra.length ? ' (' + extra.join(', ') + ')' : ''}`
}

function periodStats(S, dates) {
  const st = { logged: 0, w: [], sleep: [], water: [], pS: 0, cS: 0, fS: 0, macroDays: 0, pctSum: 0, pctCnt: 0, cardioSessions: 0, cardioMin: 0, notes: [] }
  const bw = new Map((S.bodyweight || []).filter(b => b && isDate(b.d)).map(b => [b.d, num(b.w)]))
  for (const d of dates) {
    const day = S.nutrition?.[d]
    const w = bw.get(d)
    const tot = totalsOf(day)
    const hasAny = (w > 0) || tot.kcal > 0 || num(day?.water) > 0 || num(day?.sleep) > 0 || (S.workouts || []).some(x => x?.d === d)
    if (!hasAny) continue
    st.logged++
    if (w > 0) st.w.push(w)
    if (num(day?.sleep) > 0) st.sleep.push(num(day.sleep))
    if (num(day?.water) > 0) st.water.push(num(day.water))
    if (tot.kcal > 0) {
      st.macroDays++; st.pS += tot.p; st.cS += tot.c; st.fS += tot.f
      const tg = macroTargetFor(S, d)
      if (tg) for (const k of ['p', 'c', 'f']) if (tg[k] > 0) { st.pctSum += Math.min(tot[k] / tg[k], 1.2); st.pctCnt++ }
    }
  }
  for (const wk of (S.workouts || []).filter(x => x && dates.includes(x.d))) {
    for (const e of wk.entries || []) {
      if (!isCardioEntry(e, S)) continue
      st.cardioSessions++
      const sec = (e.sets || []).reduce((a, s) => a + (num(s?.sec) > 0 ? num(s.sec) : num(s?.t) > 0 ? num(s.t) : 0), 0)
      st.cardioMin += sec / 60
    }
    if (typeof wk.note === 'string' && wk.note.trim()) st.notes.push(wk.d.slice(5) + ': ' + wk.note.trim().replace(/\s+/g, ' ').slice(0, 300))
  }
  return st
}

const setTxt = s => (s && s.p != null ? `P ${fmt(s.p, 1)} / K ${fmt(s.c, 1)} / Y ${fmt(s.f, 1)} (≈${kcalOf(s)} kcal)` : '—')

function programLines(S) {
  const rs = S.routines || []
  if (!rs.length) return { name: '—', days: [] }
  const days = rs.slice(0, 8).map(r => {
    const exs = (r.ex || []).slice(0, 10).map(e => `${nameOf(e.id, S)} ${e.sets ?? '?'}x${e.repsMin ? e.repsMin + '-' + e.reps : e.reps ?? '?'}${e.note ? ' [' + String(e.note).slice(0, 40) + ']' : ''}`)
    return `  ${r.name || 'Gün'}: ${exs.length ? exs.join('; ') : '—'}`
  })
  return { name: 'koçun atadığı program', days }
}

/**
 * The TT-VERI v1 text. `S` is the member's state with the coach's plan and targets laid over it
 * (applyPlan + coachTargets), so day types and targets are the ones the member sees.
 */
export function buildExport({ uid, name, email, S, note = '', goal = '', today = isoOf(new Date()) }) {
  const workouts = (S.workouts || []).filter(w => w && isDate(w.d)).sort((a, b) => (a.d < b.d ? -1 : 1))
  const { N, N1 } = weekWindow(today)
  const bwAll = (S.bodyweight || []).filter(b => b && isDate(b.d) && num(b.w) > 0).sort((a, b) => (a.d < b.d ? -1 : 1))
  const nutDates = Object.keys(S.nutrition || {}).filter(d => isDate(d) && totalsOf(S.nutrition[d]).kcal > 0)
  const allDates = [...nutDates, ...workouts.map(w => w.d), ...bwAll.map(b => b.d)].sort()
  const firstRecord = allDates[0] || null

  let baseWeight = '—'
  if (bwAll.length) {
    const b0 = bwAll[0].d, b1 = addDays(b0, 6)
    const ws = bwAll.filter(x => x.d >= b0 && x.d <= b1).map(x => num(x.w))
    baseWeight = `${fmt(avg(ws), 1)} kg (ilk kilo kaydından itibaren 7 gün ort., ${b0} → ${b1}, ${ws.length} ölçüm)`
  }

  const stN = periodStats(S, N), stN1 = periodStats(S, N1)
  const wkN = workouts.filter(w => N.includes(w.d)), wkN1 = workouts.filter(w => N1.includes(w.d))
  const exN = collectByExercise(wkN, S), exN1 = collectByExercise(wkN1, S), exAll = collectByExercise(workouts, S)
  const keys = [...new Set([...Object.keys(exN), ...Object.keys(exN1)])]
    .sort((a, b) => ((exAll[b]?.sessions || 0) - (exAll[a]?.sessions || 0)) || (a < b ? -1 : 1)).slice(0, 12)
  const baseMap = {}
  for (const wk of workouts) { const one = collectByExercise([wk], S); for (const k of keys) if (!baseMap[k] && one[k]) baseMap[k] = one[k] }

  const T = S.coachTargets || {}
  const prog = programLines(S)
  const L = []
  L.push('=== TT-VERI v1 ===')
  L.push('uid: ' + uid)
  L.push('üye: ' + (name ? `${name} (${email || uid})` : email || uid))
  L.push('rapor_tarihi: ' + today)
  L.push(`analiz_haftası: ${N[0]} (Pzt) → ${N[6]} (Paz)${N[6] === today ? ' — bugün Pazar, bugün dahil' : ''}`)
  L.push('TT-REVIZE başlığında kullan: hafta=' + N[6])
  L.push('hedef: ' + (goal || '— (seçilmemiş)'))
  let n = String(note || '').trim()
  if (n.length > 2000) n = n.slice(0, 2000) + ' …(kısaltıldı)'
  if (n) { L.push('kısıtlar_koç_notu:'); n.split(/\r?\n/).forEach(x => L.push('  ' + x)) } else L.push('kısıtlar_koç_notu: —')
  L.push('güncel_makro_hedef: gün tipine göre (aşağıda)')
  L.push(`  antrenman günü seti: ${setTxt(T.training)} | dinlenme günü seti: ${setTxt(T.rest)}`)
  L.push(`su_hedefi: ${T.water ? T.water + ' L' : '—'} | uyku_hedefi: ${T.sleep ? T.sleep + ' sa' : '—'}`)
  L.push('program: ' + prog.name)
  if (prog.days.length) { L.push('program_günleri:'); prog.days.forEach(x => L.push(x)) }
  L.push('')

  L.push('[BAŞLANGIÇ] ilk kayıt: ' + (firstRecord || '—'))
  if (firstRecord && firstRecord >= N1[0]) L.push('⚠ İlk kayıt N-1 haftasında veya sonrasında: başlangıç ile N-1 aynı/çok yakın dönem, uzun vadeli kıyas henüz anlamsız.')
  L.push('kilo: ' + baseWeight)
  L.push('ölçüler: —')
  L.push('top setler (hareketin ilk kayıtlı seansı):')
  const baseLines = keys.filter(k => baseMap[k]).map(k => (baseMap[k].bestDate >= N1[0]
    ? `  ${baseMap[k].name}: yeni hareket (ilk seans ${baseMap[k].bestDate}) — başlangıç kıyası yok`
    : setLine(baseMap[k], false)))
  if (baseLines.length) baseLines.forEach(x => L.push(x)); else L.push('  —')
  L.push('')

  const block = (tag, dates, st, wks, exMap, withNotes) => {
    L.push(`[${tag}] ${dates[0]} → ${dates[6]}${dates[6] === today ? ' (bugün dahil)' : ''}`)
    L.push(`log günü: ${st.logged}/7`)
    L.push('kilo ort: ' + (st.w.length ? `${fmt(avg(st.w), 1)} kg (${st.w.length} ölçüm)` : '—'))
    L.push('ölçüler: —')
    L.push(`uyku ort: ${st.sleep.length ? fmt(avg(st.sleep), 1) + ' sa' : '—'} | su ort: ${st.water.length ? fmt(avg(st.water), 1) + ' L' : '—'}`)
    if (st.macroDays) {
      const p = st.pS / st.macroDays, c = st.cS / st.macroDays, f = st.fS / st.macroDays
      L.push(`makro ort: P ${fmt(p, 0)} / K ${fmt(c, 0)} / Y ${fmt(f, 0)} (≈${kcalOf({ p, c, f })} kcal, ${st.macroDays} gün makro kaydı) | hedefe uyum: ${st.pctCnt ? '%' + Math.round(st.pctSum / st.pctCnt * 100) : '—'}`)
    } else L.push('makro ort: — | hedefe uyum: —')
    let sets = 0, ton = 0
    Object.values(exMap).forEach(m => { const w = workStats(m); sets += w.n; ton += w.ton })
    L.push(`idman: ${wks.length} seans | toplam set: ${sets} | hacim (kg×tekrar): ${Math.round(ton)} | kardiyo: ${st.cardioSessions} seans, ${Math.round(st.cardioMin)} dk`)
    L.push('top setler:')
    const tl = keys.filter(k => exMap[k]).map(k => setLine(exMap[k], true))
    if (tl.length) tl.forEach(x => L.push(x)); else L.push('  —')
    if (withNotes) { L.push('günlük notlar:'); if (st.notes.length) st.notes.forEach(x => L.push('  ' + x)); else L.push('  —') }
  }
  block('N-1', N1, stN1, wkN1, exN1, false)
  L.push('')
  block('N', N, stN, wkN, exN, true)
  L.push('=== /TT-VERI ===')
  return L.join('\n')
}

/* ---------------------------------------------------------------- import ------------------------ */

// "[[TT-REVIZE uid=… hafta=YYYY-MM-DD]] ##RAPOR … ##MESAJ … ##MAKRO … [[/TT-REVIZE]]", as before.
// macro comes back as { training?: { p, c, f }, rest?: { p, c, f } }.
export function parseRevise(text) {
  const res = { ok: false, error: null, uid: null, week: null, report: '', message: '', macro: null, macroWarning: null }
  const src = String(text || '')
  const open = src.match(/\[\[\s*TT-REVIZE([^\]]*)\]\]/i)
  if (!open) { res.error = 'Blok başlığı bulunamadı ([[TT-REVIZE ...]]).'; return res }
  const rest = src.slice(open.index + open[0].length)
  const close = rest.match(/\[\[\s*\/\s*TT-REVIZE\s*\]\]/i)
  if (!close) { res.error = 'Blok sonu bulunamadı ([[/TT-REVIZE]]). Metin yarım kopyalanmış olabilir.'; return res }
  const body = rest.slice(0, close.index)
  res.uid = open[1].match(/uid\s*=\s*([A-Za-z0-9_-]+)/i)?.[1] || null
  res.week = open[1].match(/hafta\s*=\s*(\d{4}-\d{2}-\d{2})/i)?.[1] || null
  if (!res.uid) { res.error = 'Blok başlığında uid yok. Güvenlik için uid zorunlu.'; return res }
  const sections = {}; let cur = null
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^\s*##\s*(RAPOR|MESAJ|MAKRO)\s*$/i)
    if (m) { cur = m[1].toUpperCase(); sections[cur] = sections[cur] || []; continue }
    if (cur) sections[cur].push(line)
  }
  const tx = k => (sections[k] ? sections[k].join('\n').trim() : '')
  res.report = tx('RAPOR'); res.message = tx('MESAJ')
  if (!res.report) { res.error = '##RAPOR bölümü boş veya yok.'; return res }
  if (!res.message) { res.error = '##MESAJ bölümü boş veya yok.'; return res }
  const mt = tx('MAKRO')
  if (mt) {
    const mm = {}; let bad = false
    for (const line of mt.split('\n')) {
      const m = line.match(/(antrenman|dinlenme)[^:]*:\s*P\s*(\d+(?:[.,]\d+)?)\s*\/\s*K\s*(\d+(?:[.,]\d+)?)\s*\/\s*Y\s*(\d+(?:[.,]\d+)?)/i)
      if (!m) continue
      const set = { p: num(m[2]), c: num(m[3]), f: num(m[4]) }
      if (set.p > 500 || set.c > 1000 || set.f > 300 || set.p <= 0 || set.c <= 0 || set.f <= 0) { bad = true; continue }
      mm[m[1].toLowerCase() === 'antrenman' ? 'training' : 'rest'] = set
    }
    if (bad) res.macroWarning = 'MAKRO değerleri makul aralığın dışında (P≤500, K≤1000, Y≤300, hepsi >0). Makro önerisi yok sayıldı.'
    else if (mm.training || mm.rest) res.macro = mm
    else if (/\d/.test(mt)) res.macroWarning = 'MAKRO bölümü okunamadı (beklenen: "antrenman: P 180 / K 250 / Y 60"). Makro önerisi yok sayıldı.'
  }
  res.ok = true
  return res
}

// Checks before saving an import onto a member (the tracker's rules): the uid must be this member's;
// a week date outside [analysis Monday, today] is worth a warning.
export function checkRevise(res, uid, today = isoOf(new Date())) {
  const errors = [], warnings = []
  if (res.uid !== uid) errors.push(`Bu blok başka bir üyeye ait (uid=${res.uid}). Kaydedilmedi.`)
  const { N } = weekWindow(today)
  if (!res.week) warnings.push('Blokta hafta= tarihi yok.')
  else if (res.week < N[0] || res.week > today) warnings.push(`hafta=${res.week} bu analiz haftasının (${N[0]} → ${N[6]}) dışında. Eski bir rapor olabilir.`)
  if (res.macroWarning) warnings.push(res.macroWarning)
  return { errors, warnings }
}

// A short automatic draft for the weekly message, from the analysis week's numbers.
export function autoDraft({ name, S, today = isoOf(new Date()) }) {
  const { N } = weekWindow(today)
  const st = periodStats(S, N)
  const wk = (S.workouts || []).filter(w => w && N.includes(w.d)).length
  const parts = [`Merhaba ${name || ''},`.trim(), '', `Geçen hafta (${N[0].slice(5)} → ${N[6].slice(5)}):`]
  parts.push(`• ${wk} antrenman`)
  if (st.w.length) parts.push(`• Ortalama kilo ${fmt(avg(st.w), 1)} kg`)
  if (st.macroDays) parts.push(`• ${st.macroDays} gün beslenme kaydı, hedefe uyum %${st.pctCnt ? Math.round(st.pctSum / st.pctCnt * 100) : '—'}`)
  if (st.sleep.length) parts.push(`• Ortalama uyku ${fmt(avg(st.sleep), 1)} saat`)
  parts.push('', '')
  return parts.join('\n')
}
