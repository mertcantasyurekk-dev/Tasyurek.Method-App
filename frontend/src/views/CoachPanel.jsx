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
  const load = () => {
    setError(null)
    api('/api/coach/members').then(r => setMembers(r.members)).catch(e => setError(e.message || 'Liste yüklenemedi'))
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
  const load = () => {
    setError(null)
    Promise.all([api('/api/coach/member?uid=' + encodeURIComponent(uid)), api('/api/coach/members')])
      .then(([one, all]) => { setM(one); setInfo(all.members.find(x => x.uid === uid) || { name: uid }) })
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
    </Section>

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
      </div>
    </Section>

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
