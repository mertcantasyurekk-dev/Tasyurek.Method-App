// Taşyürek Method: the coach's panel. Members, how they are training, and the program each one gets.
//
// Programs are written with openGym's own routine editor in the coach's Plan tab; "Program ata"
// copies the chosen routines and a week onto coachplan/{uid}. The member's app lays that over
// their copy and keeps it read-only (lib/firebase-api.js applyPlan, lib/coached.js). Nothing here
// writes to a member's own data.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { DAYN, weekOrder, weekStartOf, exCount, fmtDate, fmtNum, fmtVol, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { Section, Row, Button, Check, SelectRow } from '../components/ui.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { TargetsForm } from '../components/NutritionCard.jsx'
import CoachWeekly from './CoachWeekly.jsx'
import { loadTrackerPlan, oneMemberTransferSheet, everyoneTransferSheet } from '../components/TrackerTransfer.jsx'
import { backupSheet } from '../components/Backup.jsx'
import { FIELDS as MEAS_FIELDS, changesOf, latestOf as lastMeasurement, daysSinceLast as measAgo } from '../lib/measurements.js'
import { weekProgress, suppAdherence } from '../lib/daily.js'
import { TextField } from '../components/ui.jsx'
import { totalsOf, kcalOf } from '../lib/nutrition.js'

const toast = m => useUI.getState().toast(m)
const clone = o => JSON.parse(JSON.stringify(o))

// "bugün", "dün", "5 gün önce"
export function ago(iso, today = todayISO()) {
  if (!iso) return null
  const days = Math.round((new Date(today + 'T12:00:00') - new Date(iso + 'T12:00:00')) / 86400000)
  return days <= 0 ? 'bugün' : days === 1 ? 'dün' : `${days} gün önce`
}

/* ------------------------------------------------------------------ list ------------------------ */

export function CoachPanel() {
  const nav = useNavigate()
  const [members, setMembers] = useState(null)
  const [error, setError] = useState(null)
  const [warnings, setWarnings] = useState([])
  const load = () => {
    setError(null)
    api('/api/coach/members').then(r => { setMembers(r.members); setWarnings(r.warnings || []) })
      .catch(e => setError((e.data?.error || e.message || 'Liste yüklenemedi')))
  }
  useEffect(load, [])

  const line = m => !m.joined ? 'Yeni uygulamayı henüz açmadı'
    : m.lastWorkout ? `Son antrenman ${ago(m.lastWorkout)} · bu hafta ${m.workouts7}`
      : 'Henüz antrenman yok'

  return <>
    <div className="hdr">
      <div><h1>Koç paneli</h1><div className="sub">{members ? `${members.length} üye` : 'Üyeler yükleniyor…'}</div></div>
      <button className="iconbtn" onClick={load} aria-label="Yenile"><Icon name="reset" /></button>
    </div>
    {error && <div className="card small" style={{ color: 'var(--red)' }}>{error}</div>}
    {members && <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
      <Button size="sm" variant="tinted" icon="download" onClick={() => everyoneTransferSheet({ members, onDone: load })}>Tracker programlarını aktar</Button>
      <Button size="sm" icon="cloud" onClick={() => backupSheet({ members })}>Yedekler</Button>
    </div>}
    {warnings.map((w, i) => <div key={i} className="card small" style={{ color: 'var(--orange)' }}>{w} — bu bilgiler listede eksik görünür. Firestore kurallarını kontrol et.</div>)}
    {members && <div className="list">
      {members.map(m => <div key={m.uid} className="item" {...tappable(() => nav('/panel/' + m.uid))}>
        <span className="lrow-i" style={{ background: m.joined ? 'var(--acc)' : 'var(--surface-3)', color: m.joined ? 'var(--on-acc)' : undefined }}>
          <Icon name="person" /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="tt">{m.name}</div>
          <div className="ss">{line(m)}</div>
        </div>
        {!m.planAt && <span className="tag" style={{ color: 'var(--orange)', borderColor: 'var(--orange)', textTransform: 'none' }}>Program yok</span>}
        <Icon name="chevronRight" className="chev" />
      </div>)}
    </div>}
  </>
}

/* ------------------------------------------------------------------ one member ------------------ */

function PlanSummary({ plan, S }) {
  const byId = id => plan.routines.find(r => r.id === id)
  return <>
    <div className="list" style={{ marginBottom: 10 }}>
      {weekOrder(weekStartOf(S)).map(d => {
        const rs = [].concat(plan.week?.[d] || []).map(byId).filter(Boolean)
        return <div key={d} className="item">
          <div className="grow"><div className="tt">{t(DAYN[d])}</div>
            {rs.length > 0 && <div className="ss">{rs.map(r => r.name).join(' + ')}</div>}</div>
          {!rs.length && <span className="tag">{t('Rest')}</span>}
        </div>
      })}
    </div>
    <div className="small dim">{plan.routines.map(r => `${r.name} (${exCount(r.ex.length)})`).join(' · ')}</div>
  </>
}

export function CoachMember() {
  const { uid } = useParams()
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [m, setM] = useState(null)      // { state, plan, planRev }
  const [info, setInfo] = useState(null) // the list row: name, email
  const [error, setError] = useState(null)
  const [tp, setTp] = useState(null)       // the member's active tracker program, as a plan
  const load = () => {
    setError(null)
    Promise.all([api('/api/coach/member?uid=' + encodeURIComponent(uid)), api('/api/coach/members')])
      .then(([one, all]) => {
        setM(one); setInfo(all.members.find(x => x.uid === uid) || { name: uid })
        loadTrackerPlan(uid, one.state?.customEx).then(setTp).catch(() => setTp(null))
      })
      .catch(e => setError(e.message || 'Yüklenemedi'))
  }
  useEffect(load, [uid])

  if (error) return <div className="card small" style={{ color: 'var(--red)' }}>{error}</div>
  if (!m || !info) return <div className="empty">Yükleniyor…</div>

  const st = m.state || {}
  const workouts = [...(st.workouts || [])].filter(w => w?.d).sort((a, b) => (a.d < b.d ? 1 : -1))
  const bw = [...(st.bodyweight || [])].filter(b => b?.d).sort((a, b) => (a.d < b.d ? 1 : -1))
  const unit = st.unit || 'kg'

  // Their current program (the coach's plan, or the routines they brought from the tracker) into
  // the coach's own Plan tab, where openGym's editor works on it. Same ids, so assigning it back
  // keeps the member's history attached to the same routines.
  const copyToMine = () => {
    const src = m.plan || { routines: st.routines || [], customEx: st.customEx || [] }
    if (!src.routines?.length) { toast('Kopyalanacak rutin yok'); return }
    update(s => {
      const have = new Set(s.routines.map(r => r.id))
      src.routines.forEach(r => {
        const copy = clone(r)
        if (!copy.name.startsWith(info.name + ' · ')) copy.name = info.name + ' · ' + copy.name
        if (have.has(copy.id)) s.routines = s.routines.map(x => (x.id === copy.id ? copy : x))
        else s.routines.push(copy)
      })
      const used = new Set(src.routines.flatMap(r => (r.ex || []).map(e => e.id)))
      const known = new Set((s.customEx || []).map(c => c.id))
      s.customEx = [...(s.customEx || []), ...(src.customEx || []).filter(c => used.has(c.id) && !known.has(c.id)).map(clone)]
    })
    toast(`${src.routines.length} rutin Plan sekmene kopyalandı`)
  }

  return <>
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/panel')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, minWidth: 0, marginInlineStart: 10 }}><h1 style={{ fontSize: 26 }}>{info.name}</h1><div className="sub">{info.email}</div></div>
    </div>

    <Section title="Özet">
      <Row icon="calendar" title="Son antrenman" value={workouts[0] ? ago(workouts[0].d) : '—'} />
      <Row icon="flame" title="Son 7 gün" value={`${info.workouts7 || 0} antrenman`} />
      <Row icon="dumbbell" title="Toplam" value={`${workouts.length} antrenman`} />
      <Row icon="scale" title="Son kilo" value={bw[0] ? `${fmtNum(bw[0].w)} ${unit} · ${fmtDate(bw[0].d)}` : '—'} />
      <Row icon="figureRun" title="Bu hafta" value={(() => { const w = weekProgress({ ...st, coachTargets: m.targets || undefined }, todayISO()); return `${w.workouts}${w.targets.workouts ? '/' + w.targets.workouts : ''} antrenman · ${w.sessions} kardiyo, ${w.minutes} dk` })()} />
      {m.supplements?.length > 0 && <Row icon="checkCircle" title="Takviye uyumu (7 gün)" value={(() => { const a = suppAdherence({ ...st, coachSupplements: m.supplements }, todayISO(), 7); return a === null ? '—' : '%' + a })()} />}
      <Row icon="target" title="Son ölçüm" value={lastMeasurement(st) ? `${fmtDate(lastMeasurement(st).d)} · ${measAgo(st, todayISO())} gün önce` : '—'} />
    </Section>

    <CoachWeekly uid={uid} info={info} m={m} onChanged={load} />

    <Section title="Program" footer={m.plan ? `Son güncelleme: ${fmtDate(m.plan.updatedAt.slice(0, 10), true)}` : 'Bu üyeye henüz program atamadın. Üye şu an kendi aktardığı rutinleri görüyor.'}>
      <div style={{ padding: '12px 14px' }}>
        {m.plan ? <PlanSummary plan={m.plan} S={S} />
          : st.routines?.length ? <div className="small muted">Üyenin kendi rutinleri: {st.routines.map(r => r.name).join(', ')}</div>
            : <div className="small muted">Üyenin henüz rutini yok.</div>}
        <div style={{ height: 12 }} />
        <Button variant="primary" icon="calendar" onClick={() => assignSheet({ uid, name: info.name, plan: m.plan, onSaved: load })}>
          {m.plan ? 'Programı güncelle' : 'Program ata'}</Button>
        <div style={{ height: 8 }} />
        <Button icon="upload" onClick={copyToMine}>Programını Plan sekmeme kopyala</Button>
        {tp && <><div style={{ height: 8 }} />
          <Button icon="download" onClick={() => oneMemberTransferSheet({ uid, name: info.name, tp, m, onDone: load })}>Tracker programını ata („{tp.programName}")</Button></>}
      </div>
    </Section>

    <NutritionSection uid={uid} name={info.name} m={m} st={st} onSaved={load} />

    <SupplementsSection uid={uid} name={info.name} m={m} onSaved={load} />

    <MeasurementsSection st={st} />

    <Section title="Son antrenmanlar">
      {workouts.length ? workouts.slice(0, 8).map(w => {
        const sets = (w.entries || []).reduce((n, e) => n + (e.sets || []).filter(s => s.done).length, 0)
        return <Row key={w.id || w.d} icon="checkCircle" title={w.name || 'Antrenman'}
          subtitle={`${fmtDate(w.d, true)} · ${sets} set${w.vol ? ' · ' + fmtVol(Math.round(w.vol), unit) : ''}`} />
      }) : <Row title="Henüz kayıt yok" />}
    </Section>
  </>
}

/* ------------------------------------------------------------------ assign ---------------------- */

function AssignSheet({ uid, name, plan, onSaved, close }) {
  const S = useStore(s => s.S)
  const mine = S.routines
  const inPlan = new Set((plan?.routines || []).map(r => r.id))
  const [picked, setPicked] = useState(() => new Set(mine.filter(r => inPlan.has(r.id)).map(r => r.id)))
  const [week, setWeek] = useState(() => {
    const w = {}
    for (const [d, ids] of Object.entries(plan?.week || {})) { const id = [].concat(ids)[0]; if (mine.some(r => r.id === id)) w[d] = id }
    return w
  })
  const [busy, setBusy] = useState(false)
  const gone = (plan?.routines || []).filter(r => !mine.some(x => x.id === r.id))

  const toggle = id => setPicked(p => {
    const n = new Set(p)
    if (n.has(id)) { n.delete(id); setWeek(w => Object.fromEntries(Object.entries(w).filter(([, v]) => v !== id))) } else n.add(id)
    return n
  })
  const chosen = mine.filter(r => picked.has(r.id))
  const dayOptions = [{ value: '', label: t('Rest') }, ...chosen.map(r => ({ value: r.id, label: r.name }))]

  const save = async () => {
    if (!chosen.length) { toast('En az bir rutin seç'); return }
    // "Seda · Gün 1" is how the coach tells copies apart in their own Plan tab; the member sees "Gün 1".
    const prefix = name + ' · '
    const routines = chosen.map(r => { const c = clone(r); if (c.name.startsWith(prefix)) c.name = c.name.slice(prefix.length); return c })
    const used = new Set(routines.flatMap(r => (r.ex || []).map(e => e.id)))
    const customEx = (S.customEx || []).filter(c => used.has(c.id)).map(clone)
    const w = {}
    Object.entries(week).forEach(([d, id]) => { if (id && picked.has(id)) w[d] = [id] })
    setBusy(true)
    try {
      await api('/api/coach/plan', { method: 'PUT', body: JSON.stringify({ uid, plan: { routines, week: w, customEx } }) })
      toast(`Program ${name} için kaydedildi`)
      close(); onSaved && onSaved()
    } catch (e) { toast(e.message || 'Kaydedilemedi') } finally { setBusy(false) }
  }

  return <>
    <h3>{name} — program</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>Rutinleri kendi Plan sekmende düzenlersin. Burada hangilerinin {name} için geçerli olduğunu ve hangi günlere denk geldiğini seçiyorsun.</div>
    {!mine.length && <div className="card small">Plan sekmende henüz rutin yok. Önce orada rutinleri oluştur.</div>}
    {gone.length > 0 && <div className="card small" style={{ color: 'var(--orange)' }}>
      Şu an atanmış {gone.map(r => `„${r.name}"`).join(', ')} senin Plan sekmende yok. Kaydedersen programdan çıkar. Tutmak için önce „Programını Plan sekmeme kopyala"yı kullan.</div>}
    <h4 className="sec">{t('Routines')}</h4>
    <div className="list">
      {mine.map(r => <div key={r.id} className="item" {...tappable(() => toggle(r.id))}>
        <Check checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
      </div>)}
    </div>
    {chosen.length > 0 && <>
      <h4 className="sec">{t('Week schedule')}</h4>
      <Section>
        {weekOrder(weekStartOf(S)).map(d => <SelectRow key={d} title={t(DAYN[d])} value={week[d] || ''} options={dayOptions}
          onChange={v => setWeek(w => { const n = { ...w }; if (v) n[d] = v; else delete n[d]; return n })} />)}
      </Section>
    </>}
    <Button variant="primary" icon="checkCircle" disabled={busy || !chosen.length} onClick={save}>{busy ? 'Kaydediliyor…' : 'Kaydet ve ata'}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export const assignSheet = props => useUI.getState().openSheet(close => <AssignSheet {...props} close={close} />)

/* ------------------------------------------------------------------ nutrition ------------------- */

const setLine = s => (s ? `P ${fmtNum(s.p)} · K ${fmtNum(s.c)} · Y ${fmtNum(s.f)} · ${fmtNum(kcalOf(s))} kcal` : '—')

// The last seven days the member logged anything, averaged: what they eat against what they were given.
export function weekAverage(st, today = todayISO()) {
  const from = new Date(today + 'T12:00:00'); from.setDate(from.getDate() - 6)
  const fromIso = from.toISOString().slice(0, 10)
  const days = Object.entries(st?.nutrition || {}).filter(([d, v]) => d >= fromIso && d <= today && totalsOf(v).kcal > 0)
  if (!days.length) return null
  const sum = days.reduce((a, [, v]) => { const t = totalsOf(v); return { p: a.p + t.p, c: a.c + t.c, f: a.f + t.f, water: a.water + (v.water || 0) } }, { p: 0, c: 0, f: 0, water: 0 })
  const k = days.length
  const avg = { p: sum.p / k, c: sum.c / k, f: sum.f / k }
  return { days: k, ...avg, kcal: kcalOf(avg), water: sum.water / k }
}

function NutritionSection({ uid, name, m, st, onSaved }) {
  const T = m.targets
  const avg = weekAverage(st)
  return <Section title="Beslenme" footer={T ? `Son güncelleme: ${fmtDate(T.updatedAt.slice(0, 10), true)}` : 'Henüz hedef yok. Üye girdiklerini yine de kaydeder.'}>
    <Row icon="barbell" title="Antrenman günü" subtitle={setLine(T?.training)} />
    <Row icon="moon" title="Dinlenme günü" subtitle={setLine(T?.rest)} />
    <Row icon="drop" title="Su · uyku" value={T ? `${T.water ? fmtNum(T.water) + ' L' : '—'} · ${T.sleep ? fmtNum(T.sleep) + ' sa' : '—'}` : '—'} />
    <Row icon="calendar" title="Haftalık" value={T && (T.workoutsPerWeek || T.cardioSessionsPerWeek || T.cardioMinutesPerWeek) ? `${T.workoutsPerWeek || '—'} antrenman · ${T.cardioSessionsPerWeek || '—'} kardiyo · ${T.cardioMinutesPerWeek || '—'} dk` : '—'} />
    <Row icon="chartLine" title="Son 7 gün ortalaması" subtitle={avg ? `${avg.days} gün kayıt · ${setLine(avg)}${avg.water ? ' · su ' + fmtNum(Math.round(avg.water * 10) / 10) + ' L' : ''}` : 'Kayıt yok'} />
    <div style={{ padding: '10px 14px 14px' }}>
      <Button variant="primary" icon="pencil" onClick={() => targetsSheet({ uid, name, initial: T || m.trackerTargets, fromTracker: !T && !!m.trackerTargets, onSaved })}>
        {T ? 'Hedefleri düzenle' : 'Hedef belirle'}</Button>
    </div>
  </Section>
}

function TargetsSheet({ uid, name, initial, fromTracker, onSaved, close }) {
  const [busy, setBusy] = useState(false)
  const save = async targets => {
    setBusy(true)
    try {
      await api('/api/coach/targets', { method: 'PUT', body: JSON.stringify({ uid, targets }) })
      toast(`${name} için hedefler kaydedildi`); close(); onSaved && onSaved()
    } catch (e) { toast(e.data?.error || e.message || 'Kaydedilemedi') } finally { setBusy(false) }
  }
  return <>
    <h3>{name} — beslenme hedefleri</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{fromTracker ? 'Eski tracker\'daki hedeflerle dolduruldu. Kontrol edip kaydet.' : 'Antrenman ve dinlenme günü için ayrı makro setleri. Üye gün tipine göre doğru seti görür.'}</div>
    <TargetsForm initial={initial} busy={busy} onSave={save} />
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}
export const targetsSheet = props => useUI.getState().openSheet(close => <TargetsSheet {...props} close={close} />)

/* ------------------------------------------------------------------ measurements ---------------- */

const cmv = v => fmtNum(Math.round(v * 10) / 10)
const sgn = v => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '±') + cmv(Math.abs(v)))

function MeasurementsSection({ st }) {
  const ch = changesOf(st)
  const rows = ch ? MEAS_FIELDS.filter(f => ch[f.key]) : []
  return <Section title="Vücut ölçüleri" footer={ch ? 'Başlangıç: her ölçünün ilk kaydı. Son: bir önceki ölçüme göre değişim.' : 'Üye henüz ölçüm girmedi.'}>
    {rows.length > 0 && <div style={{ overflowX: 'auto', padding: '8px 14px 12px' }}>
      <table className="small" style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
        <thead><tr className="muted" style={{ textAlign: 'end' }}>
          <th style={{ textAlign: 'start', fontWeight: 500, padding: '4px 0' }}>cm</th>
          <th style={{ fontWeight: 500 }}>Başlangıç</th><th style={{ fontWeight: 500 }}>Şimdi</th>
          <th style={{ fontWeight: 500 }}>Toplam</th><th style={{ fontWeight: 500 }}>Son</th>
        </tr></thead>
        <tbody>{rows.map(f => { const c = ch[f.key]; const first = c.dFirst == null ? c.v : Math.round((c.v - c.dFirst) * 10) / 10
          return <tr key={f.key} style={{ borderTop: '1px solid var(--sep-op)', textAlign: 'end' }}>
            <td style={{ textAlign: 'start', padding: '6px 0' }}>{f.label}</td>
            <td className="muted">{cmv(first)}</td><td><b>{cmv(c.v)}</b></td>
            <td>{sgn(c.dFirst)}</td><td className="muted">{sgn(c.dPrev)}</td>
          </tr> })}</tbody>
      </table>
    </div>}
  </Section>
}

/* ------------------------------------------------------------------ supplements ----------------- */

const newId = p => p + Math.random().toString(36).slice(2, 8)

function SupplementsSection({ uid, name, m, onSaved }) {
  const [list, setList] = useState(null)       // editing copy
  const [busy, setBusy] = useState(false)
  const cur = m.supplements || []
  const edit = list !== null
  const start = () => setList(JSON.parse(JSON.stringify(cur.length ? cur : [{ id: newId('g'), label: 'Sabah', items: [] }])))
  const fromTracker = async () => {
    try {
      const x = await api('/api/coach/tracker-extra?uid=' + encodeURIComponent(uid))
      if (!x.supplements?.length) { toast('Tracker\'da bu üye için takviye listesi yok'); return }
      setList(x.supplements)
    } catch (e) { toast(e.message) }
  }
  const save = async () => {
    setBusy(true)
    try { await api('/api/coach/supplements', { method: 'PUT', body: JSON.stringify({ uid, supplements: list }) }); setList(null); toast(`${name} için takviyeler kaydedildi`); onSaved && onSaved() }
    catch (e) { toast(e.data?.error || e.message) } finally { setBusy(false) }
  }
  const setG = (gi, f) => setList(l => l.map((g, i) => (i === gi ? f(g) : g)))
  if (!edit) return <Section title="Takviyeler" footer={cur.length ? 'Üye ana sayfasında her gün işaretler.' : 'Liste yok: üyede takviye kartı görünmez.'}>
    {cur.map(g => <Row key={g.id} icon="checkCircle" title={g.label} subtitle={g.items.map(i => i.name + (i.dose ? ` (${i.dose})` : '')).join(' · ')} />)}
    <div style={{ padding: '10px 14px 14px' }} className="row" >
      <Button size="sm" variant="tinted" icon="pencil" onClick={start}>{cur.length ? 'Düzenle' : 'Liste oluştur'}</Button>
      <div style={{ width: 8 }} />
      {!cur.length && <Button size="sm" icon="download" onClick={fromTracker}>Tracker'dan al</Button>}
    </div>
  </Section>
  return <Section title="Takviyeler — düzenle" footer="Boş satırlar kaydedilmez. Grubu silmek için içindeki her şeyi sil.">
    <div style={{ padding: '10px 14px 14px' }}>
      {list.map((g, gi) => <div key={g.id} className="card" style={{ marginBottom: 10 }}>
        <TextField value={g.label} onChange={e => setG(gi, x => ({ ...x, label: e.target.value }))} placeholder="Grup (ör. Sabah — kahvaltıyla)" maxLength={80} />
        {g.items.map((it, ii) => <div key={it.id} className="row" style={{ gap: 6, marginTop: 8 }}>
          <TextField value={it.name} onChange={e => setG(gi, x => ({ ...x, items: x.items.map((y, j) => (j === ii ? { ...y, name: e.target.value } : y)) }))} placeholder="Ad" maxLength={80} style={{ flex: 2 }} />
          <TextField value={it.dose} onChange={e => setG(gi, x => ({ ...x, items: x.items.map((y, j) => (j === ii ? { ...y, dose: e.target.value } : y)) }))} placeholder="Doz" maxLength={120} style={{ flex: 2 }} />
          <button className="iconbtn" aria-label="Sil" onClick={() => setG(gi, x => ({ ...x, items: x.items.filter((_, j) => j !== ii) }))}><Icon name="trash" /></button>
        </div>)}
        <div style={{ height: 8 }} />
        <Button size="sm" variant="ghost" icon="plus" onClick={() => setG(gi, x => ({ ...x, items: [...x.items, { id: newId('i'), name: '', dose: '' }] }))}>Takviye ekle</Button>
      </div>)}
      <Button size="sm" variant="ghost" icon="plus" onClick={() => setList(l => [...l, { id: newId('g'), label: '', items: [] }])}>Grup ekle</Button>
      <div style={{ height: 10 }} />
      <Button variant="primary" icon="checkCircle" disabled={busy} onClick={save}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" onClick={() => setList(null)}>{t('Cancel')}</Button>
    </div>
  </Section>
}
