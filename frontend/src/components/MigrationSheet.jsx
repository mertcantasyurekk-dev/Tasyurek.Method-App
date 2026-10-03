// Taşyürek Method: moving everyone over from the old tracker, in the coach panel.
// Preview first, from each member's REAL tracker data and without writing anything: what their
// first sign-in will bring (history, weights, nutrition, measurements, cardio) and which exercise
// names will not match the library. Then the coach's side, for everyone at once and only where it
// is still missing here: program, targets, supplements, the coach's note and goal, 360° reports,
// weekly messages. A member's own history moves on their first sign-in (autoImportFromTracker).
import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { useUI } from '../store/useUI.js'
import { readPayload, convertTracker } from '../lib/tracker-import.js'
import { loadTrackerPlan, assignTrackerPlan } from './TrackerTransfer.jsx'
import { fmtDate } from '../lib/format.js'
import { Button, Check } from './ui.jsx'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const range = ws => (ws.length ? `${fmtDate(ws[0].d)} → ${fmtDate(ws[ws.length - 1].d)}` : '')

function previewOf(payload, memberCustom) {
  if (!payload) return null
  const c = convertTracker(payload, memberCustom || [])
  return {
    program: c.programName, days: c.routines.length,
    workouts: c.workouts.length, range: range(c.workouts),
    weights: c.bodyweight.length, nutrition: c.nutrition.length, measurements: c.measurements.length,
    cardio: Object.keys(c.cardio || {}).length,
    unmatched: [...new Set(c.customEx.map(x => x.n))]
  }
}

function Counts({ p }) {
  if (!p) return <div className="small muted">Tracker'da veri yok.</div>
  const bits = [
    p.program ? `Program „${p.program}" (${p.days} gün)` : 'Program yok',
    `${p.workouts} antrenman${p.range ? ` (${p.range})` : ''}`,
    `${p.weights} kilo`, `${p.nutrition} gün beslenme`, `${p.measurements} ölçüm`, `${p.cardio} gün kardiyo`
  ]
  return <>
    <div className="small" style={{ lineHeight: 1.5 }}>{bits.join(' · ')}</div>
    {p.unmatched.length > 0 && <div className="small" style={{ marginTop: 4, color: 'var(--orange)' }}>
      Kütüphaneyle eşleşmeyen {p.unmatched.length} hareket (kendi adıyla gelir): {p.unmatched.slice(0, 8).join(', ')}{p.unmatched.length > 8 ? ` +${p.unmatched.length - 8}` : ''}
    </div>}
  </>
}

function Migration({ members, onDone, close }) {
  const [rows, setRows] = useState(null)        // [{ uid, name, m, tp, extras, notes, preview }]
  const [mine, setMine] = useState(undefined)   // the coach's own preview
  const [picked, setPicked] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])

  useEffect(() => {
    let on = true
    ;(async () => {
      try { const own = readPayload((await api('/api/tracker')).payload); if (on) setMine(previewOf(own, [])) } catch { if (on) setMine(null) }
      const out = []
      for (const mm of members) {
        try {
          const [m, pay, extras, notes] = await Promise.all([
            api('/api/coach/member?uid=' + encodeURIComponent(mm.uid)),
            api('/api/coach/tracker-payload?uid=' + encodeURIComponent(mm.uid)),
            api('/api/coach/tracker-extra?uid=' + encodeURIComponent(mm.uid)),
            api('/api/coach/notes?uid=' + encodeURIComponent(mm.uid))
          ])
          const payload = readPayload(pay.payload)
          const tp = payload ? await loadTrackerPlan(mm.uid, m.state?.customEx) : null
          out.push({ uid: mm.uid, name: mm.name, m, tp, extras, notes, preview: previewOf(payload, m.state?.customEx) })
        } catch (e) { out.push({ uid: mm.uid, name: mm.name, error: e.message }) }
        if (on) setRows([...out])
      }
      if (on) setPicked(new Set(out.filter(r => r.preview).map(r => r.uid)))
    })()
    return () => { on = false }
  }, [])

  const todo = r => {
    if (!r.preview && !r.extras) return []
    const t = []
    if (!r.m.plan && r.tp) t.push('program')
    if (!r.m.targets && r.m.trackerTargets && (r.m.trackerTargets.training || r.m.trackerTargets.rest || r.m.trackerTargets.workoutsPerWeek)) t.push('hedefler')
    if (!r.m.supplements && r.extras?.supplements?.length) t.push('takviyeler')
    if (!r.notes?.note && !r.notes?.goal && !r.notes?.reports?.length && (r.extras?.note || r.extras?.goal || r.extras?.reports?.length)) t.push('not/raporlar')
    if (!(r.m.reviews || []).length && r.extras?.reviews?.length) t.push('değerlendirmeler')
    return t
  }

  const run = async () => {
    setBusy(true)
    const out = []
    for (const r of (rows || []).filter(x => picked.has(x.uid) && !x.error)) {
      const done = []
      try {
        const t = todo(r)
        if (t.includes('program')) {
          const res = await assignTrackerPlan(r.uid, r.tp, { targets: r.m.targets, trackerTargets: r.m.trackerTargets, supplements: r.m.supplements })
          done.push('program'); if (res.targetsSet) done.push('hedefler')
          if (!r.m.supplements && r.extras?.supplements?.length) done.push('takviyeler')
        } else {
          if (t.includes('hedefler')) { await api('/api/coach/targets', { method: 'PUT', body: JSON.stringify({ uid: r.uid, targets: r.m.trackerTargets }) }); done.push('hedefler') }
          if (t.includes('takviyeler')) { await api('/api/coach/supplements', { method: 'PUT', body: JSON.stringify({ uid: r.uid, supplements: r.extras.supplements }) }); done.push('takviyeler') }
        }
        if (t.includes('not/raporlar')) {
          await api('/api/coach/notes', { method: 'PUT', body: JSON.stringify({ uid: r.uid, note: r.extras.note || '', goal: r.extras.goal || '', replaceReports: r.extras.reports || [] }) })
          done.push('not/raporlar')
        }
        if (t.includes('değerlendirmeler')) {
          for (const v of r.extras.reviews) await api('/api/coach/review', { method: 'PUT', body: JSON.stringify({ uid: r.uid, text: v.text, week: v.week, sentAt: v.sentAt }) })
          done.push(`${r.extras.reviews.length} değerlendirme`)
        }
        out.push(`✓ ${r.name}: ${done.length ? done.join(', ') : 'koç tarafı zaten tamam'}`)
      } catch (e) { out.push(`✗ ${r.name}: ${done.length ? done.join(', ') + ' tamam, sonra ' : ''}${e.data?.error || e.message}`) }
      setLog([...out])
    }
    setBusy(false)
    onDone && onDone()
    toast('Koç tarafı taşındı')
  }

  const toggle = uid => setPicked(p => { const n = new Set(p); n.has(uid) ? n.delete(uid) : n.add(uid); return n })
  return <>
    <h3>Tracker'dan geçiş</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      Önizleme gerçek tracker verisinden okunur, hiçbir şey yazmaz. Üyelerin geçmişi (antrenman, kilo, beslenme, ölçüm, kardiyo)
      yeni uygulamaya <b>ilk girişlerinde kendiliğinden</b> taşınır. Buradan senin tarafındakileri taşırsın; sadece eksik olanlar yazılır.
    </div>
    <div className="card">
      <div className="lbl2">Senin verin (ilk girişinde taşınır)</div>
      {mine === undefined ? <div className="small muted">Okunuyor…</div> : <Counts p={mine} />}
    </div>
    {!rows ? <div className="empty small">Üyelerin tracker verisi okunuyor…</div> : rows.map(r => <div key={r.uid} className="card" style={{ display: 'flex', gap: 10 }}>
      {!r.error && <Check checked={picked.has(r.uid)} onChange={() => !busy && toggle(r.uid)} />}
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="tt" style={{ fontWeight: 600 }}>{r.name}</div>
        {r.error ? <div className="small" style={{ color: 'var(--red)' }}>Okunamadı: {r.error}</div> : <>
          <Counts p={r.preview} />
          <div className="small dim" style={{ marginTop: 4 }}>Koç tarafında taşınacak: {todo(r).length ? todo(r).join(', ') : 'yok (hepsi hazır)'}</div>
        </>}
      </div>
    </div>)}
    {log.length > 0 && <div className="card small" style={{ whiteSpace: 'pre-wrap' }}>{log.join('\n')}</div>}
    <Button variant="primary" icon="download" disabled={busy || !rows || !picked.size || log.length > 0} onClick={run}>
      {busy ? 'Taşınıyor…' : `Koç tarafını taşı (${picked.size})`}</Button>
    <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={close}>{log.length ? 'Kapat' : 'Vazgeç'}</Button>
  </>
}
export const migrationSheet = props => ui().openSheet(close => <Migration {...props} close={close} />)
