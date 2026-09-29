// Taşyürek Method: the coach's weekly work on one member, as in the tracker's Haftalık Rapor —
// the coach's note and goal, the 360° analysis (export → analyse → import), the weekly message
// and the archive of reports. Data: coachnotes/{uid} (coach only) and coachplan/{uid}.reviews
// (what the member reads). Formats: lib/coach360.js.
import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { useUI } from '../store/useUI.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { applyPlan } from '../lib/firebase-api.js'
import { buildExport, parseRevise, checkRevise, autoDraft, weekWindow, GOALS } from '../lib/coach360.js'
import { kcalOf } from '../lib/nutrition-core.js'
import Icon from '../components/Icon.jsx'
import { Section, Row, Button, Segmented, TextArea } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'

const toast = m => useUI.getState().toast(m)
const when = iso => (iso ? fmtDate(String(iso).slice(0, 10), true) : '—')
const setLine = s => (s ? `P ${fmtNum(s.p)} / K ${fmtNum(s.c)} / Y ${fmtNum(s.f)} (≈${fmtNum(kcalOf(s))} kcal)` : '—')

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch { /* fall back below */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok
  } catch { return false }
}

// The member as the analysis must see them: their copy with the coach's program and targets on top.
const memberView = m => {
  const S = JSON.parse(JSON.stringify(m.state || {}))
  if (m.plan) applyPlan(S, m.plan)
  if (m.targets) S.coachTargets = m.targets
  if (m.supplements) S.coachSupplements = m.supplements
  return S
}

export default function CoachWeekly({ uid, info, m, onChanged }) {
  const [notes, setNotes] = useState(null)       // { note, goal, reports }
  const [note, setNote] = useState('')
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState('')
  const [paste, setPaste] = useState('')
  const [preview, setPreview] = useState(null)   // { res, check }
  const [draft, setDraft] = useState('')
  const [extras, setExtras] = useState(null)
  const [openReport, setOpenReport] = useState(null)

  const loadNotes = () => api('/api/coach/notes?uid=' + encodeURIComponent(uid)).then(n => { setNotes(n); setNote(n.note); setGoal(n.goal) })
    .catch(e => toast(e.message || 'Notlar yüklenemedi'))
  useEffect(() => {
    loadNotes()
    api('/api/coach/tracker-extra?uid=' + encodeURIComponent(uid)).then(setExtras).catch(() => setExtras(null))
  }, [uid])

  if (!notes) return <div className="empty small">Koç notları yükleniyor…</div>
  const S = memberView(m)
  const { N } = weekWindow()
  const reviews = [...(m.reviews || [])].reverse()
  const reports = [...(notes.reports || [])].reverse()
  const dirty = note !== notes.note || goal !== notes.goal

  const saveNotes = async () => {
    setBusy('notes')
    try { const n = await api('/api/coach/notes', { method: 'PUT', body: JSON.stringify({ uid, note, goal }) }); setNotes(n); toast('Not ve hedef kaydedildi') }
    catch (e) { toast(e.data?.error || e.message) } finally { setBusy('') }
  }

  const copyExport = async () => {
    const text = buildExport({ uid, name: info.name, email: info.email, S, note: notes.note, goal: notes.goal })
    const ok = await copyText(text)
    toast(ok ? `Analiz verisi kopyalandı · hafta=${N[6]}` : 'Kopyalanamadı — tarayıcı panoya izin vermedi')
  }

  const doPreview = () => {
    const res = parseRevise(paste)
    setPreview({ res, check: res.ok ? checkRevise(res, uid) : { errors: [res.error], warnings: [] } })
  }

  const saveImport = async () => {
    const { res } = preview
    setBusy('import')
    try {
      const n = await api('/api/coach/notes', { method: 'PUT', body: JSON.stringify({ uid, addReport: { week: res.week, text: res.report, message: res.message, macro: res.macro } }) })
      setNotes(n); setDraft(res.message); setPaste('')
      toast('Rapor arşive kaydedildi, mesaj taslağa kondu')
    } catch (e) { toast(e.data?.error || e.message) } finally { setBusy('') }
  }

  const applyMacros = () => {
    const mac = preview.res.macro
    const cur = m.targets || {}
    // Only the macro sets change: water, sleep and the weekly targets stay as they are.
    const next = { ...cur, training: mac.training || cur.training || null, rest: mac.rest || cur.rest || null }
    delete next.updatedAt
    confirmSheet({
      title: 'Makroları uygula',
      message: <>
        <div>Antrenman günü: {setLine(cur.training)} → <b>{setLine(next.training)}</b></div>
        <div style={{ marginTop: 6 }}>Dinlenme günü: {setLine(cur.rest)} → <b>{setLine(next.rest)}</b></div>
        <div className="small dim" style={{ marginTop: 8 }}>{info.name} yeni hedefleri hemen görür. Su, uyku ve haftalık hedefler değişmez.</div>
      </>,
      confirmText: 'Uygula',
      onConfirm: async () => {
        try { await api('/api/coach/targets', { method: 'PUT', body: JSON.stringify({ uid, targets: next }) }); toast('Makro hedefleri güncellendi'); onChanged && onChanged() }
        catch (e) { toast(e.data?.error || e.message) }
      }
    })
  }

  const send = () => confirmSheet({
    title: `${info.name} için gönder`,
    message: 'Mesaj üyenin uygulamasında hemen görünür. Gönderdikten sonra geri alabilirsin.',
    confirmText: 'Gönder',
    onConfirm: async () => {
      try { await api('/api/coach/review', { method: 'PUT', body: JSON.stringify({ uid, text: draft, week: N[6] }) }); setDraft(''); toast('Değerlendirme gönderildi'); onChanged && onChanged() }
      catch (e) { toast(e.data?.error || e.message) }
    }
  })
  const takeBack = r => confirmSheet({
    title: 'Mesajı geri al', message: 'Üyenin uygulamasından kaldırılır.', confirmText: 'Geri al', danger: true,
    onConfirm: async () => { try { await api('/api/coach/review', { method: 'PUT', body: JSON.stringify({ uid, remove: r.id }) }); onChanged && onChanged() } catch (e) { toast(e.message) } }
  })

  // The tracker's note, goal, reports and messages — offered once, while this side is still empty.
  const canBring = extras && (extras.note || extras.goal || extras.reports.length || extras.reviews.length)
    && !notes.note && !notes.goal && !notes.reports.length && !(m.reviews || []).length
  const bring = async () => {
    setBusy('bring')
    try {
      await api('/api/coach/notes', { method: 'PUT', body: JSON.stringify({ uid, note: extras.note, goal: extras.goal, replaceReports: extras.reports }) })
      for (const r of extras.reviews) await api('/api/coach/review', { method: 'PUT', body: JSON.stringify({ uid, text: r.text, week: r.week, sentAt: r.sentAt }) })
      await loadNotes(); onChanged && onChanged()
      toast('Tracker\'daki not, hedef, raporlar ve değerlendirmeler aktarıldı')
    } catch (e) { toast(e.data?.error || e.message) } finally { setBusy('') }
  }

  return <>
    {canBring && <div className="card small" style={{ borderLeft: '3px solid var(--acc)' }}>
      Eski tracker'da {info.name} için not, hedef ya da geçmiş raporlar var.
      <div style={{ height: 8 }} /><Button size="sm" variant="tinted" icon="download" disabled={busy === 'bring'} onClick={bring}>Tracker'dan aktar</Button>
    </div>}

    <Section title="Koç notu ve hedef" footer="Sadece sen görürsün. Sağlık durumu, kısıtlar, sakatlıklar… 360° analize eklenir.">
      <div style={{ padding: '12px 14px' }}>
        <TextArea rows={4} value={note} onChange={e => setNote(e.target.value)} maxLength={5000} placeholder="Ör. sol diz patellar tendon geçmişi: squat ve leg extension yok" />
        <div style={{ height: 10 }} />
        <div className="small muted" style={{ marginBottom: 6 }}>Hedef</div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {GOALS.map(g => <button key={g} className={'chip nocap' + (goal === g ? ' on' : '')} onClick={() => setGoal(goal === g ? '' : g)}>{g}</button>)}
        </div>
        <div style={{ height: 12 }} />
        <Button variant={dirty ? 'primary' : undefined} icon="checkCircle" disabled={!dirty || busy === 'notes'} onClick={saveNotes}>{dirty ? 'Not ve hedefi kaydet' : 'Kaydedildi'}</Button>
      </div>
    </Section>

    <Section title="360° Analiz" footer={`Analiz haftası: ${N[0].slice(5)} → ${N[6].slice(5)} (Pzt → Paz). Hangi gün bakarsan bak aynı hafta gelir.`}>
      <div style={{ padding: '12px 14px' }}>
        <Button icon="upload" onClick={copyExport}>Analiz verisini kopyala</Button>
        <div className="small dim" style={{ margin: '8px 0 14px' }}>Kopyalanan metni analiz sohbetine yapıştır. Dönen [[TT-REVIZE]] bloğunu aşağıya yapıştır.</div>
        <TextArea rows={4} value={paste} onChange={e => { setPaste(e.target.value); setPreview(null) }} placeholder="[[TT-REVIZE uid=… hafta=…]] … [[/TT-REVIZE]]" />
        <div style={{ height: 8 }} />
        <Button variant={paste.trim() ? 'tinted' : undefined} icon="magnifier" disabled={!paste.trim()} onClick={doPreview}>Önizle</Button>
        {preview && <div style={{ marginTop: 12 }}>
          {preview.check.errors.map((x, i) => <div key={i} className="card small" style={{ color: 'var(--red)' }}><Icon name="warning" /> {x}</div>)}
          {preview.check.warnings.map((x, i) => <div key={i} className="card small" style={{ color: 'var(--orange)' }}><Icon name="warning" /> {x}</div>)}
          {preview.res.ok && !preview.check.errors.length && <>
            <div className="card small">
              <div className="lbl2">Rapor (sadece sen)</div>
              <div style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto', marginTop: 4 }}>{preview.res.report}</div>
            </div>
            <div className="card small">
              <div className="lbl2">Üyeye mesaj</div>
              <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{preview.res.message}</div>
            </div>
            {preview.res.macro && <div className="card small">
              <div className="lbl2">Makro önerisi</div>
              <div style={{ marginTop: 4 }}>Antrenman: {setLine(preview.res.macro.training)}<br />Dinlenme: {setLine(preview.res.macro.rest)}</div>
            </div>}
            <Button variant="primary" icon="checkCircle" disabled={busy === 'import'} onClick={saveImport}>Raporu kaydet, mesajı taslağa koy</Button>
            {preview.res.macro && <><div style={{ height: 8 }} /><Button icon="chartLine" onClick={applyMacros}>Makroları uygula…</Button></>}
          </>}
        </div>}
      </div>
    </Section>

    <Section title="Haftalık değerlendirme" footer="Gönderdiğin mesaj üyenin ana sayfasında görünür.">
      <div style={{ padding: '12px 14px' }}>
        <TextArea rows={6} value={draft} onChange={e => setDraft(e.target.value)} maxLength={8000} placeholder="Üyeye bu haftanın değerlendirmesi…" />
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <Button size="sm" icon="sparkles" onClick={() => setDraft(autoDraft({ name: info.name, S }) + draft)}>Otomatik taslak</Button>
          <Button size="sm" variant="primary" icon="envelope" disabled={!draft.trim()} onClick={send}>Gönder</Button>
        </div>
      </div>
      {reviews.slice(0, 6).map(r => <Row key={r.id} icon="envelope" title={when(r.sentAt)} subtitle={r.text.length > 120 ? r.text.slice(0, 120) + '…' : r.text}>
        <button className="iconbtn" aria-label="Geri al" onClick={() => takeBack(r)}><Icon name="trash" /></button>
      </Row>)}
    </Section>

    <Section title={`Rapor arşivi (${reports.length})`}>
      {reports.length ? reports.slice(0, 12).map((r, i) => <div key={i}>
        <Row icon="clipboard" title={r.week ? `Hafta ${r.week}` : when(r.importedAt)} subtitle={r.macro ? 'makro önerisi vardı' : undefined}
          onClick={() => setOpenReport(openReport === i ? null : i)}>
          <Icon name={openReport === i ? 'chevronUp' : 'chevronDown'} className="lrow-c" />
        </Row>
        {openReport === i && <div className="small" style={{ whiteSpace: 'pre-wrap', padding: '4px 16px 14px' }}>{r.text}</div>}
      </div>) : <Row title="Henüz rapor yok" />}
    </Section>
  </>
}
