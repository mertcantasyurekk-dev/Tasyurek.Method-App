// Taşyürek Method: backups — the automatic copy every two days (checked when the coach opens the
// app) and a full copy to download. Server side of it: lib/firebase-api.js "backups".
import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { useUI } from '../store/useUI.js'
import { fmtDate } from '../lib/format.js'
import { Section, Row, Button } from './ui.jsx'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const kb = n => (n ? `${Math.round(n / 1024)} KB` : '')
const when = iso => (iso ? `${fmtDate(iso.slice(0, 10), true)} ${new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}` : '—')

// Once per app start, for the coach: a copy if the last one is two or more days old. Quiet.
let tried = false
export function maybeAutoBackup() {
  if (tried) return
  tried = true
  api('/api/coach/backup', { method: 'POST', body: JSON.stringify({}) })
    .then(r => { if (!r.skipped) console.info('[TT] otomatik yedek:', r.id, kb(r.bytes)) })
    .catch(e => console.warn('[TT] otomatik yedek alınamadı:', e.message))
}

export async function downloadFullBackup() {
  const data = await api('/api/coach/backup/data')
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `tasyurek-tam-yedek-${data.createdAt.slice(0, 10)}.json`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
  return blob.size
}

function BackupSheet({ close }) {
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState('')
  const load = () => api('/api/coach/backups').then(setInfo).catch(e => toast(e.message))
  useEffect(() => { load() }, [])
  const now = async () => {
    setBusy('now')
    try { const r = await api('/api/coach/backup', { method: 'POST', body: JSON.stringify({ force: true }) }); toast(`Yedek alındı · ${kb(r.bytes)}${r.parts ? ` · ${r.parts} parça` : ''}`); load() }
    catch (e) { toast(e.data?.error || e.message) } finally { setBusy('') }
  }
  const dl = async () => {
    setBusy('dl')
    try { const n = await downloadFullBackup(); toast(`İndirildi · ${kb(n)}`) }
    catch (e) { toast(e.data?.error || e.message) } finally { setBusy('') }
  }
  return <>
    <h3>Yedekler</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      Her yedek hem eski tracker'ın verisini hem yeni uygulamanın tamamını içerir: antrenmanlar, beslenme, programlar, hedefler, koç notları, raporlar, ortak yemek listesi.
      Otomatik yedek 2 günde bir, uygulamayı açtığında alınır; son 15 yedek saklanır.
    </div>
    <Section title="Otomatik yedek">
      <Row icon="cloud" title="Son yedek" value={info ? when(info.meta?.lastAt) : '…'} />
    </Section>
    <Button variant="primary" icon="cloud" disabled={!!busy} onClick={now}>{busy === 'now' ? 'Yedekleniyor…' : 'Şimdi yedekle'}</Button>
    <div style={{ height: 8 }} />
    <Button icon="download" disabled={!!busy} onClick={dl}>{busy === 'dl' ? 'Hazırlanıyor…' : 'Tam yedeği bilgisayarıma indir'}</Button>
    <div style={{ height: 14 }} />
    <Section title={`Firestore'daki yedekler${info ? ` (${info.backups.length})` : ''}`}>
      {info?.backups.length ? info.backups.map(b => <Row key={b.id} title={b.day} subtitle={`${when(b.createdAt)} · ${kb(b.bytes)}${b.split ? ' · parçalı' : ''}`} />)
        : <Row title={info ? 'Henüz yedek yok' : 'Yükleniyor…'} />}
    </Section>
    <div className="small dim" style={{ margin: '0 2px 12px' }}>Geri yükleme gerektiğinde bu yedeklerden yapılır; Firestore Console'daki backups koleksiyonunda ya da indirdiğin dosyada durur.</div>
    <Button variant="ghost" className="dim" onClick={close}>Kapat</Button>
  </>
}
export const backupSheet = () => ui().openSheet(close => <BackupSheet close={close} />)
