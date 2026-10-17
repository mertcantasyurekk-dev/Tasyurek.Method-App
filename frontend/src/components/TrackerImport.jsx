// Taşyürek Method: Settings → "Eski Tracker'dan aktar". One-way, read-only on the tracker's side.
import { api } from '../lib/api.js'
import { todayISO } from '../lib/format.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { confirmSheet } from '../sheets.jsx'
import { readPayload, convertTracker, applyTrackerImport, importOutdated, IMPORT_VERSION } from '../lib/tracker-import.js'

const toast = m => useUI.getState().toast(m)

export async function importFromTracker() {
  let payload, extra = {}
  try { const r = await api('/api/tracker'); payload = readPayload(r.payload); extra = { timers: r.workoutTimers, mealLog: r.mealLog, today: todayISO(), coach: !!useStore.getState().user?.admin, supplements: r.customSupplements } }
  catch { toast('Tracker verisine ulaşılamadı — internet bağlantını kontrol et.'); return }
  if (!payload) { toast('Tracker\'da aktarılacak veri bulunamadı.'); return }

  const S = useStore.getState().S
  const conv = convertTracker(payload, S.customEx || [], extra)
  const first = !S.trackerImport
  const nR = first && !S.coachPlanAt ? conv.routines.length : 0
  const coachExtras = extra.coach ? [conv.otherRoutines?.length, conv.myTargets, conv.mySupplements?.length].some(Boolean) : false
  if (!nR && !coachExtras && !conv.workouts.length && !conv.bodyweight.length && !conv.nutrition?.length && !conv.measurements?.length && !Object.keys(conv.cardio || {}).length) { toast('Tracker\'da aktarılacak veri bulunamadı.'); return }

  const lines = [
    nR ? `${nR} antrenman günü rutin olarak eklenecek${conv.programName ? ` (${conv.programName})` : ''}.` : '',
    conv.workouts.length ? `${conv.workouts.length} antrenman kaydı. Burada zaten antrenmanı olan günler atlanır.` : '',
    conv.bodyweight.length ? `${conv.bodyweight.length} kilo kaydı.` : '',
    conv.nutrition?.length ? `${conv.nutrition.length} günlük beslenme kaydı (makro, su, uyku).` : '',
    conv.measurements?.length ? `${conv.measurements.length} vücut ölçüsü kaydı.` : '',
    Object.keys(conv.cardio || {}).length ? `${Object.keys(conv.cardio).length} günlük kardiyo kaydı.` : '',
    extra.coach && conv.otherRoutines?.length ? `${conv.otherRoutines.length} rutin, aktif olmayan eski programlardan (Plan sekmesine „Program adı · Gün" olarak).` : '',
    extra.coach && conv.myTargets && !S.myTargets ? 'Kendi makro, su, uyku ve haftalık hedeflerin.' : '',
    extra.coach && conv.mySupplements?.length && !(S.mySupplements || []).length ? 'Takviye listen.' : '',
    S.coachPlanAt ? 'Programın koçun tarafından atandığı için tracker\'daki rutinler aktarılmayacak.' : first ? '' : 'Rutinler daha önce aktarıldığı için tekrar eklenmeyecek.'
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
      useStore.getState().update(st => { res = applyTrackerImport(st, conv, { coach: !!extra.coach }) })
      const parts = [
        res.routines ? `${res.routines} rutin` : '',
        res.otherRoutines ? `${res.otherRoutines} eski program rutini` : '',
        res.targets ? 'hedeflerin' : '',
        res.supplements ? `${res.supplements} takviye` : '',
        res.workouts ? `${res.workouts} antrenman` : '',
        res.weights ? `${res.weights} kilo kaydı` : '',
        res.days ? `${res.days} gün beslenme` : '',
        res.measurements ? `${res.measurements} ölçüm` : '',
        res.cardioDays ? `${res.cardioDays} gün kardiyo` : ''
      ].filter(Boolean)
      toast(parts.length ? `Aktarıldı: ${parts.join(', ')}` : 'Yeni kayıt yok — hepsi zaten burada.')
    }
  })
}

// The first time someone opens this app, their tracker history comes over by itself — nobody has to
// find the button. Once per profile and import version (S.trackerImport is the stamp, with v; it syncs,
// so another device does not import again; an older v imports again to bring what is new), a few seconds after start so the first sync has landed. Importing twice is
// harmless anyway: workouts have stable ids, days already here win.
const autoTried = new Set()   // per account: signing out and in as someone else tries for them too
export function autoImportFromTracker() {
  const uid = useStore.getState().user?.id
  if (!uid || autoTried.has(uid)) return
  autoTried.add(uid)
  setTimeout(async () => {
    const st = useStore.getState()
    if (st.user?.id !== uid || !importOutdated(st.S)) return
    let payload, extra = {}
    try { const r = await api('/api/tracker'); payload = readPayload(r.payload); extra = { timers: r.workoutTimers, mealLog: r.mealLog, today: todayISO(), coach: !!useStore.getState().user?.admin, supplements: r.customSupplements } } catch { return }
    if (!payload) return
    const S = useStore.getState().S
    if (!importOutdated(S)) return
    const conv = convertTracker(payload, S.customEx || [], extra)
    const coachExtras = extra.coach ? [conv.otherRoutines?.length, conv.myTargets, conv.mySupplements?.length].some(Boolean) : false
    if (!conv.routines.length && !coachExtras && !conv.workouts.length && !conv.bodyweight.length && !conv.nutrition?.length && !conv.measurements?.length && !Object.keys(conv.cardio || {}).length) {
      useStore.getState().update(s => { s.trackerImport = { at: new Date().toISOString(), v: IMPORT_VERSION, empty: true } })
      return
    }
    let res
    useStore.getState().update(s => { res = applyTrackerImport(s, conv, { coach: !!extra.coach }) })
    const parts = [res.workouts && `${res.workouts} antrenman`, res.weights && `${res.weights} kilo`, res.days && `${res.days} gün beslenme`,
      res.measurements && `${res.measurements} ölçüm`, res.cardioDays && `${res.cardioDays} gün kardiyo`,
      res.otherRoutines && `${res.otherRoutines} eski program rutini`, res.targets && 'hedeflerin', res.supplements && `${res.supplements} takviye`].filter(Boolean)
    if (parts.length) toast(`Eski kayıtların taşındı: ${parts.join(', ')} ✨`)
  }, 3500)
}
