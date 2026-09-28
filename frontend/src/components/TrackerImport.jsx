// Taşyürek Method: Settings → "Eski Tracker'dan aktar". One-way, read-only on the tracker's side.
import { api } from '../lib/api.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { confirmSheet } from '../sheets.jsx'
import { readPayload, convertTracker, applyTrackerImport } from '../lib/tracker-import.js'

const toast = m => useUI.getState().toast(m)

export async function importFromTracker() {
  let payload
  try { payload = readPayload((await api('/api/tracker')).payload) }
  catch { toast('Tracker verisine ulaşılamadı — internet bağlantını kontrol et.'); return }
  if (!payload) { toast('Tracker\'da aktarılacak veri bulunamadı.'); return }

  const S = useStore.getState().S
  const conv = convertTracker(payload, S.customEx || [])
  const first = !S.trackerImport
  const nR = first ? conv.routines.length : 0
  if (!nR && !conv.workouts.length && !conv.bodyweight.length) { toast('Tracker\'da aktarılacak veri bulunamadı.'); return }

  const lines = [
    nR ? `${nR} antrenman günü rutin olarak eklenecek${conv.programName ? ` (${conv.programName})` : ''}.` : '',
    conv.workouts.length ? `${conv.workouts.length} antrenman kaydı. Burada zaten antrenmanı olan günler atlanır.` : '',
    conv.bodyweight.length ? `${conv.bodyweight.length} kilo kaydı.` : '',
    first ? '' : 'Rutinler daha önce aktarıldığı için tekrar eklenmeyecek.'
  ].filter(Boolean)
  const message = <>
    {lines.map((l, i) => <div key={i} style={{ marginBottom: 6 }}>{l}</div>)}
    <div className="small dim" style={{ marginTop: 10 }}>Tracker'daki verilere dokunulmaz.</div>
  </>

  confirmSheet({
    title: first ? 'Tracker verilerini aktar' : 'Yeni kayıtları aktar',
    message,
    confirmText: 'Aktar',
    onConfirm: () => {
      let res
      useStore.getState().update(st => { res = applyTrackerImport(st, conv) })
      const parts = [
        res.routines ? `${res.routines} rutin` : '',
        res.workouts ? `${res.workouts} antrenman` : '',
        res.weights ? `${res.weights} kilo kaydı` : ''
      ].filter(Boolean)
      toast(parts.length ? `Aktarıldı: ${parts.join(', ')}` : 'Yeni kayıt yok — hepsi zaten burada.')
    }
  })
}
