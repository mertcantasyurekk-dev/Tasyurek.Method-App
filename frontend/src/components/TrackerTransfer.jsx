// Taşyürek Method: moving the programs members train in the old tracker today over as the coach's
// plan in this app — one member from their page, or everyone at once from the panel. Read-only on
// the tracker's side; writes coachplan/{uid} (plan, and targets where the member has none yet).
import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { useUI } from '../store/useUI.js'
import { readPayload, trackerPlan } from '../lib/tracker-import.js'
import { DAYN } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { Section, Row, Button, Check } from './ui.jsx'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

export async function loadTrackerPlan(uid, memberCustom) {
  const { payload } = await api('/api/coach/tracker-payload?uid=' + encodeURIComponent(uid))
  const p = readPayload(payload)
  return p ? trackerPlan(p, memberCustom || []) : null
}

// Writes the plan, and the tracker's targets when the member has none here yet.
export async function assignTrackerPlan(uid, tp, { targets, trackerTargets, supplements }) {
  await api('/api/coach/plan', { method: 'PUT', body: JSON.stringify({ uid, plan: { routines: tp.routines, week: tp.week, customEx: tp.customEx } }) })
  // The tracker's supplement list, when this member has none here yet.
  if (!supplements) {
    try {
      const x = await api('/api/coach/tracker-extra?uid=' + encodeURIComponent(uid))
      if (x.supplements?.length) await api('/api/coach/supplements', { method: 'PUT', body: JSON.stringify({ uid, supplements: x.supplements }) })
    } catch { /* the plan is what matters here */ }
  }
  let targetsSet = false
  if (!targets && trackerTargets && (trackerTargets.training || trackerTargets.rest)) {
    try { await api('/api/coach/targets', { method: 'PUT', body: JSON.stringify({ uid, targets: trackerTargets }) }); targetsSet = true } catch { /* the plan is what matters here */ }
  }
  return { targetsSet }
}

export const weekLine = tp => DAY_ORDER.filter(d => tp.week[d]).map(d => `${t(DAYN[d])}: ${tp.routines.find(r => r.id === tp.week[d][0])?.name || '?'}`)

/* ---- one member ---- */

function OneMember({ uid, name, tp, m, onDone, close }) {
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try {
      const r = await assignTrackerPlan(uid, tp, { targets: m.targets, trackerTargets: m.trackerTargets, supplements: m.supplements })
      toast(`${name}: tracker programı atandı${r.targetsSet ? ', beslenme hedefleri de' : ''}`); close(); onDone && onDone()
    } catch (e) { toast(e.data?.error || e.message) } finally { setBusy(false) }
  }
  return <>
    <h3>{name} — tracker programı</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>„{tp.programName}" · {tp.routines.length} gün. Günler sırayla haftaya yerleştirildi, sonra „Programı güncelle" ile değiştirebilirsin.</div>
    <Section>
      {weekLine(tp).map((l, i) => <Row key={i} title={l.split(': ')[0]} subtitle={l.split(': ').slice(1).join(': ')} />)}
    </Section>
    {m.plan && <div className="card small" style={{ color: 'var(--orange)' }}>{name} için zaten bir program var. Aktarım onu bu programla değiştirir.</div>}
    {!m.targets && m.trackerTargets && <div className="small dim" style={{ margin: '0 2px 12px' }}>Beslenme hedefi henüz yok: tracker'daki hedefler de aktarılacak.</div>}
    <Button variant="primary" icon="download" disabled={busy} onClick={go}>{busy ? 'Aktarılıyor…' : 'Aktar ve ata'}</Button>
    <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}
export const oneMemberTransferSheet = props => ui().openSheet(close => <OneMember {...props} close={close} />)

/* ---- everyone ---- */

function Everyone({ members, onDone, close }) {
  const [rows, setRows] = useState(null)   // [{ uid, name, tp, hasPlan, m }]
  const [picked, setPicked] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])
  useEffect(() => {
    let on = true
    ;(async () => {
      const out = []
      for (const mm of members) {
        try {
          const m = await api('/api/coach/member?uid=' + encodeURIComponent(mm.uid))
          const tp = await loadTrackerPlan(mm.uid, m.state?.customEx)
          if (tp) out.push({ uid: mm.uid, name: mm.name, tp, hasPlan: !!m.plan, m })
        } catch { /* skip a member we cannot read */ }
      }
      if (!on) return
      setRows(out); setPicked(new Set(out.filter(r => !r.hasPlan).map(r => r.uid)))
    })()
    return () => { on = false }
  }, [])
  const toggle = uid => setPicked(p => { const n = new Set(p); n.has(uid) ? n.delete(uid) : n.add(uid); return n })
  const go = async () => {
    setBusy(true)
    const out = []
    for (const r of rows.filter(x => picked.has(x.uid))) {
      try { const res = await assignTrackerPlan(r.uid, r.tp, { targets: r.m.targets, trackerTargets: r.m.trackerTargets, supplements: r.m.supplements }); out.push(`✓ ${r.name}${res.targetsSet ? ' (+ hedefler)' : ''}`) }
      catch (e) { out.push(`✗ ${r.name}: ${e.data?.error || e.message}`) }
      setLog([...out])
    }
    setBusy(false); onDone && onDone()
    toast(`${out.filter(x => x.startsWith('✓')).length} üyeye program atandı`)
  }
  return <>
    <h3>Tracker programlarını aktar</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>Üyelerin eski tracker'da şu an kullandığı aktif program, senin atadığın program olarak gelir. Programı olmayan üyeler işaretli. Tracker'a dokunulmaz.</div>
    {!rows ? <div className="empty small">Üyelerin tracker verisi okunuyor…</div> : !rows.length ? <div className="empty small">Tracker'da programı olan üye bulunamadı.</div> : <div className="list">
      {rows.map(r => <div key={r.uid} className="item" onClick={() => !busy && toggle(r.uid)} style={{ cursor: 'pointer' }}>
        <Check checked={picked.has(r.uid)} onChange={() => toggle(r.uid)} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="tt">{r.name}</div>
          <div className="ss">„{r.tp.programName}" · {r.tp.routines.length} gün{r.hasPlan ? ' · zaten programı var, değiştirilir' : ''}</div>
        </div>
      </div>)}
    </div>}
    {log.length > 0 && <div className="card small" style={{ whiteSpace: 'pre-wrap' }}>{log.join('\n')}</div>}
    <div style={{ height: 10 }} />
    <Button variant="primary" icon="download" disabled={busy || !rows || !picked.size || log.length > 0} onClick={go}>{busy ? 'Aktarılıyor…' : `Aktar (${picked.size})`}</Button>
    <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={close}>{log.length ? 'Kapat' : t('Cancel')}</Button>
  </>
}
export const everyoneTransferSheet = props => ui().openSheet(close => <Everyone {...props} close={close} />)
