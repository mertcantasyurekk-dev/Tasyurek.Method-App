// Taşyürek Method: restore from a backup (Coach panel → Backups → a backup). Add-only for records;
// the chosen coach parts are put back as the backup had them. Logic: lib/restore.js; Firestore
// side: lib/firebase-api.js "restore".
import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { fmtDate } from '../lib/format.js'
import { KINDS, missingFrom, countOf, totalOf, pick, applyRestore, coachPartsIn } from '../lib/restore.js'
import { Section, Row, Button, Switch } from './ui.jsx'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const when = iso => (iso ? `${fmtDate(iso.slice(0, 10), true)} ${new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}` : '—')

/* ---------------------------------------------------------------- member side ------------------ */
// Once per app start: a restore the coach left is added to this profile, then the request goes.
// It waits for boot to have pulled the server's copy (store `ready`), so the records are checked
// against the real profile; the request is deleted only once the profile with them is on the
// server. Until then it stays and is applied again next time, which adds nothing twice.
const whenReady = () => new Promise(res => {
  if (useStore.getState().ready) return res()
  const un = useStore.subscribe(s => { if (s.ready) { un(); res() } })
})
let checked = false
export async function applyPendingRestore() {
  if (checked) return
  checked = true
  await whenReady()
  let req
  try { req = (await api('/api/restore')).request } catch (e) { console.warn('[TT] geri yükleme isteği okunamadı:', e.message); checked = false; return }
  if (!req?.data) return
  let n = 0
  useStore.getState().update(s => { n = applyRestore(s, req.data) })
  if (n) {
    await useStore.getState().pushState()
    if (useStore.getState().unsyncedChanges?.().owed) { checked = false; return }   // not on the server yet: try again later
  }
  try { await api('/api/restore', { method: 'DELETE' }) } catch (e) { console.warn('[TT] geri yükleme isteği silinemedi:', e.message) }
  if (n) toast(`Koçun yedekten ${n} kaydını geri yükledi`)
}

/* ---------------------------------------------------------------- coach side ------------------- */
function RestoreBackup({ backup, close }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api('/api/coach/backup?id=' + encodeURIComponent(backup.id)).then(setData).catch(e => setError(e.data?.error || e.message)) }, [backup.id])
  const me = useStore(s => s.user)
  return <>
    <h3>Yedekten geri yükle</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {backup.day} · {when(backup.createdAt)}. Geri yükleme sadece <b>ekler</b>: üyede olmayan kayıtlar gelir, var olanların üzerine yazılmaz, hiçbir şey silinmez.
    </div>
    {error ? <Section><Row title="Yedek açılamadı" subtitle={error} /></Section>
      : !data ? <Section><Row title="Yedek okunuyor…" /></Section>
      : <Section title={`Yedekteki profiller (${data.members.length})`}>
        {data.members.map(m => {
          const c = m.state ? totalOf(missingFrom(m.state, null)) : 0
          return <Row key={m.uid} icon="person" title={m.uid === me?.id ? `${m.name} (sen)` : m.name}
            subtitle={m.state ? `${c} kayıt` : 'Yeni uygulamada kaydı yok'} accessory="chevron"
            onClick={() => ui().openSheet(c2 => <RestoreMember backup={data} member={m} mine={m.uid === me?.id} close={c2} />)} />
        })}
      </Section>}
    <div className="small dim" style={{ margin: '0 2px 12px' }}>Eski tracker'ın verisi (userdata) geri yüklenmez; yeni uygulama ona hiç yazmaz.</div>
    <Button variant="ghost" className="dim" onClick={close}>Kapat</Button>
  </>
}

function RestoreMember({ backup, member, mine, close }) {
  const myState = useStore(s => s.S)
  const [cur, setCur] = useState(mine ? myState : undefined)
  const [error, setError] = useState('')
  const [kinds, setKinds] = useState([])
  const [parts, setParts] = useState([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (mine) return
    api('/api/coach/member?uid=' + encodeURIComponent(member.uid)).then(r => setCur(r.state || null)).catch(e => setError(e.data?.error || e.message))
  }, [member.uid, mine])
  const loaded = cur !== undefined
  const missing = loaded && member.state ? missingFrom(member.state, cur || {}) : null
  const counts = missing ? countOf(missing) : null
  const inBackup = member.state ? countOf(missingFrom(member.state, null)) : null
  const coachParts = mine ? [] : coachPartsIn(member.plan, member.notes)
  const toggle = (list, set, k) => set(list.includes(k) ? list.filter(x => x !== k) : [...list, k])
  const chosenRecords = missing ? totalOf(pick(missing, kinds)) : 0

  const run = async () => {
    setBusy(true)
    try {
      const done = []
      if (chosenRecords) {
        const data = { ...pick(missing, kinds), unit: (cur || {}).unit }
        if (mine) {
          let n = 0
          useStore.getState().update(s => { n = applyRestore(s, data) })
          done.push(`${n} kayıt eklendi`)
        } else {
          const r = await api('/api/coach/restore', { method: 'PUT', body: JSON.stringify({ uid: member.uid, data, from: backup.id }) })
          done.push(`${chosenRecords} kayıt üyenin uygulamasına gönderildi${r.waiting ? ' (bekleyen istekle birleşti)' : ''}`)
        }
      }
      if (parts.length) {
        await api('/api/coach/restore-coach', { method: 'PUT', body: JSON.stringify({ uid: member.uid, parts, plan: member.plan, notes: member.notes }) })
        done.push(`${parts.length} koç bölümü yedektekiyle değiştirildi`)
      }
      toast(done.join(' · ') || 'Seçili bir şey yok')
      close()
    } catch (e) { toast(e.data?.error || e.message) } finally { setBusy(false) }
  }
  const confirm = () => ui().openSheet(c => <div style={{ textAlign: 'center', padding: '4px 0' }}>
    <h3 style={{ marginBottom: 8 }}>{member.name}</h3>
    <div className="muted" style={{ marginBottom: 16, lineHeight: 1.5 }}>
      {chosenRecords > 0 && <div>{chosenRecords} eksik kayıt eklenecek{mine ? '.' : '; üye uygulamayı bir sonraki açışında görür.'}</div>}
      {parts.length > 0 && <div style={{ color: 'var(--orange)' }}>{coachParts.filter(p => parts.includes(p.key)).map(p => p.label).join(', ')}: şu anki hâli yedektekiyle değiştirilecek.</div>}
    </div>
    <Button variant="primary" onClick={() => { c(); run() }}>Geri yükle</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={c}>Vazgeç</Button>
  </div>, { kind: 'center' })

  return <>
    <h3>{member.name}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{backup.day} yedeği · {mine ? 'senin profilin, hemen eklenir' : 'üyenin kayıtları onun uygulamasınca eklenir'}</div>
    {error ? <Section><Row title="Üyenin şu anki verisi okunamadı" subtitle={error} /></Section>
      : !loaded ? <Section><Row title="Karşılaştırılıyor…" /></Section>
      : !member.state ? <Section><Row title="Bu yedekte üyenin uygulama kaydı yok" /></Section>
      : <Section title="Kayıtlar (sadece eksikler eklenir)" footer="Üyenin bilerek sildiği ölçü günü ve kardiyo kaydı geri gelmez.">
        {KINDS.map(k => <Row key={k.key} title={k.label}
          subtitle={`Yedekte ${inBackup[k.key]} · eksik ${counts[k.key]}`}>
          <Switch checked={kinds.includes(k.key)} disabled={!counts[k.key]} onChange={() => toggle(kinds, setKinds, k.key)} />
        </Row>)}
      </Section>}
    {coachParts.length > 0 && <Section title="Koç verileri (seçilen değiştirilir)" footer="Seçtiğin bölümün şu anki hâli silinir, yedekteki gelir.">
      {coachParts.map(p => <Row key={p.key} title={p.label}>
        <Switch checked={parts.includes(p.key)} onChange={() => toggle(parts, setParts, p.key)} />
      </Row>)}
    </Section>}
    <Button variant="primary" disabled={busy || (!chosenRecords && !parts.length)} onClick={confirm}>{busy ? 'Geri yükleniyor…' : 'Geri yükle'}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>Kapat</Button>
  </>
}

export const restoreSheet = backup => ui().openSheet(close => <RestoreBackup backup={backup} close={close} />)
