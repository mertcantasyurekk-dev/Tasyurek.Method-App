// Taşyürek Method: the message of the day on Home — built from the member's own numbers, never
// generic, and motivating: it sees the effort first, puts a number on it, frames a gap as the next
// win, and ends on something to do. Each rule looks at one thing (this week's sessions, yesterday's protein, sleep, cardio…)
// and, when it applies, offers a message with a weight; the heaviest wins. The wording rotates by
// date so the same topic reads differently on different days, and stays the same all day.
// It never comments on the direction of body weight: whether down is good depends on the goal,
// which is the coach's to judge.
import { totalsOf, macroTargetFor, targetsOf, dayOf } from './nutrition.js'
import { effectiveRoutineIds } from './history.js'
import { weekProgress, suppAdherence } from './daily.js'
import { isDue as measurementDue, latestOf as lastMeasurement } from './measurements.js'

const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const f0 = n => Math.round(n).toLocaleString('tr-TR')
const f1 = n => (Math.round(n * 10) / 10).toLocaleString('tr-TR')
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 } return h }
const pick = (arr, today, key) => arr[hash(today + key) % arr.length]

/** { key, text } or null. `name` is the first name to greet with (optional). */
export function dailyMessage(S, today, name = '') {
  if (!S) return null
  const hi = name ? name.split(' ')[0] : ''
  const y = addDays(today, -1)
  const T = targetsOf(S)
  const cand = []
  const add = (key, weight, texts) => cand.push({ key, weight, text: pick(texts, today, key) })

  // today's plan
  let routineIds = []
  try { routineIds = effectiveRoutineIds(S, today) } catch { routineIds = [] }
  const routine = routineIds.map(id => (S.routines || []).find(r => r.id === id)).filter(Boolean).map(r => r.name).join(' + ')
  const trainedToday = (S.workouts || []).some(w => w?.d === today)

  // the week
  const wk = weekProgress(S, today)
  const need = wk.targets.workouts ? wk.targets.workouts - wk.workouts : 0
  const daysInclToday = wk.daysLeft + 1

  if (trainedToday) add('done-today', 90, [
    `Bugünün antrenmanı cebinde${hi ? ', ' + hi : ''}! 💪 Şimdi kazancı kalıcı yap: proteini tamamla, erken yat.`,
    `Harika iş! Bugün salonda verdiğin emek, bu gece uykuda kasa dönüşecek. Proteini ve suyu tamamla. 🔥`,
    `Bir antrenman daha tamam, bu hafta ${wk.workouts}${wk.targets.workouts ? '/' + wk.targets.workouts : ''}. Disiplinin sonuç getiriyor${hi ? ', ' + hi : ''}! ✨`])

  // Behind: every remaining day is needed (urgent), or all but one (a nudge that others can outrank).
  if (!trainedToday && need > 0 && need === daysInclToday - 1) add('week-pace', 52, [
    `Haftalık hedefe ${need} antrenman var, ${daysInclToday} günün içinde. Tempoyu bugün yakala, hafta senin olsun!${routine ? ` „${routine}" hazır. 💪` : ' 💪'}`,
    `${need} antrenmanla haftayı tamamlarsın. Bugün bir tanesini cebe koymak için harika bir gün! 🔥`])
  if (!trainedToday && need > 0 && need >= daysInclToday) add('week-behind', 80, [
    `Hedefe ${need} antrenman, önünde ${daysInclToday} gün var. Tam senin haftanı tamamlayacağın an!${routine ? ` Bugün: „${routine}". Hadi başlayalım 💪` : ' 💪'}`,
    `Bu hafta ${wk.workouts}/${wk.targets.workouts}. Kalan ${need} seans seni bekliyor ve bunu yapabileceğini biliyoruz.${routine ? ` Bugünün planı „${routine}" hazır.` : ''} 🔥`])
  if (!trainedToday && wk.targets.workouts && wk.workouts > 0 && need > 0 && need < daysInclToday - 1) add('week-on-track', 58, [
    `Haftaya güçlü başladın: ${wk.workouts}/${wk.targets.workouts} antrenman tamam. Tempon tam yerinde, böyle devam! 🎯`,
    `${wk.workouts} antrenman şimdiden cepte. Bu ritimle haftalık hedef senin${hi ? ', ' + hi : ''}! 💪`])

  // protein, the last two days
  const days2 = [addDays(today, -1), addDays(today, -2)].map(d => ({ d, t: totalsOf(dayOf(S, d)), g: macroTargetFor(S, d) }))
  const logged2 = days2.filter(x => x.t.kcal > 0 && x.g?.p)
  if (logged2.length === 2 && logged2.every(x => x.t.p < x.g.p * 0.85)) {
    const avgP = (logged2[0].t.p + logged2[1].t.p) / 2, avgT = (logged2[0].g.p + logged2[1].g.p) / 2
    add('protein-low', 75, [
      `Son iki gün ortalama ${f0(avgP)} g protein aldın, hedefe sadece ${f0(avgT - avgP)} g kaldı. Bugün her öğüne bir protein kaynağı ekle, farkı hissedeceksin! 💪`,
      `Kaslarının yakıtı protein: hedefin ${f0(avgT)} g, son günlerde ${f0(avgP)} g. Kahvaltıya yumurta, ara öğüne yoğurt ekle, açığı bugün kapatıyoruz! 🔥`])
  }

  // yesterday's log
  const yT = totalsOf(dayOf(S, y)), yG = macroTargetFor(S, y)
  const everLogged = Object.values(S.nutrition || {}).some(d => totalsOf(d).kcal > 0)
  if (everLogged && yT.kcal === 0) add('no-log-yesterday', 70, [
    `Yeni gün, yeni sayfa! Dün kayıt kaçtı, sorun değil. İlk öğününü girerek bugünü güçlü başlat. ✨`,
    `Mükemmel olmak değil, devam etmek kazandırır. Bugün ilk öğününü gir, ritmini geri yakala${hi ? ', ' + hi : ''}! 💪`])
  else if (yG && yT.kcal > 0 && Math.abs(yT.kcal - yG.kcal) <= yG.kcal * 0.07 && yT.p >= yG.p * 0.95) add('hit-yesterday', 50, [
    `Dün tam isabet: ${f0(yT.kcal)}/${f0(yG.kcal)} kcal, ${f0(yT.p)} g protein! 🎯 Bu disiplinle hedefe emin adımlarla gidiyorsun.`,
    `Dünkü beslenmen kusursuzdu (${f0(yT.kcal)} kcal, ${f0(yT.p)} g protein). Sonuçlar tam da böyle günlerden doğar${hi ? ', ' + hi : ''}! 🔥`])

  // sleep, the last three nights
  const sleeps = [1, 2, 3].map(i => Number(dayOf(S, addDays(today, -i))?.sleep) || 0).filter(x => x > 0)
  if (T?.sleep && sleeps.length >= 2) {
    const avg = sleeps.reduce((a, b) => a + b, 0) / sleeps.length
    if (avg < T.sleep - 1) add('sleep-low', 65, [
      `Gizli silahın uyku! Son gecelerde ${f1(avg)} saat uyudun, hedefin ${f1(T.sleep)}. Bu akşam yarım saat erken yat, yarın farkı hisset. 🌙`,
      `Kaslar salonda yorulur, uykuda büyür. Son günlerde ${f1(T.sleep - avg)} saat eksik var. Bu gece kendine iyi bir uyku hediye et. 🌙`])
  }

  // cardio
  if (wk.targets.minutes && wk.minutes < wk.targets.minutes && wk.daysLeft <= 3) {
    const left = wk.targets.minutes - wk.minutes
    add('cardio-behind', 60, [
      `Kardiyoda ${f0(wk.minutes)} dk tamam, hedefe ${f0(left)} dk kaldı. Günde ${f0(left / daysInclToday)} dk tempolu yürüyüşle haftayı kapatırsın! 🚶`,
      `Son düzlüğe girdik: kardiyo hedefine ${f0(left)} dk var. Kulaklığını tak, tempolu bir yürüyüşle bitir! 🎧`])
  } else if (wk.targets.minutes && wk.minutes >= wk.targets.minutes / 2 && wk.minutes < wk.targets.minutes) add('cardio-progress', 42, [
    `Kardiyonun yarısını geçtin: ${f0(wk.minutes)}/${f0(wk.targets.minutes)} dk. Güzel gidiyor, bitiş çizgisi görünüyor! 🏁`])

  if (!trainedToday && routine) add('training-day', 55, [
    `Bugün antrenman günü: „${routine}". Kendinin en iyi versiyonu için bir adım daha${hi ? ', ' + hi : ''}! 💪`,
    `„${routine}" seni bekliyor! İyi ısın, setlerini kaydet, bugün bir önceki senden güçlü ol. 🔥`])

  // logging streak
  let streak = 0
  for (let i = 1; i <= 60; i++) { if (totalsOf(dayOf(S, addDays(today, -i))).kcal > 0) streak++; else break }
  if (streak >= 5) add('streak', 45, [
    `${streak} gündür kesintisiz kayıt! 🔥 Bu tutarlılık, hedefe giden yolun ta kendisi.`,
    `${streak} günlük seri! Her gün attığın bu küçük adımlar büyük bir değişim yaratıyor${hi ? ', ' + hi : ''}. ✨`])

  if (wk.targets.workouts && wk.workouts >= wk.targets.workouts) add('week-done', 40, [
    `Haftalık antrenman hedefi tamam: ${wk.workouts}/${wk.targets.workouts}! 🏆 Şimdi beslenme ve uykuyla bu emeği taçlandır.`,
    `Hedef tamamlandı, ${wk.workouts} antrenman! Kendinle gurur duy${hi ? ', ' + hi : ''}. 🏆`])

  if (lastMeasurement(S) && measurementDue(S, today)) add('measure', 35, [
    `Ölçüm zamanı! Tartının göremediği değişimi mezura gösterir. Haftalık ölçümlerini gir, ilerlemeni gör. 📏`])

  const sa = suppAdherence(S, today, 7)
  if (sa !== null && sa < 70) add('supps', 30, [
    `Takviyelerini sabah rutinine bağla: kahveyi hazırlarken al, işaretle. Küçük alışkanlık, büyük fark! ✨`])

  if (!cand.length) {
    if (!T && !everLogged && !(S.workouts || []).length) return { key: 'welcome', text: `Hoş geldin${hi ? ', ' + hi : ''}! 🎉 Yolculuğun bugün başlıyor. İlk adım: bugünün kilosunu ve ilk öğününü gir, gerisini birlikte kuracağız.` }
    add('rest', 5, [
      `Dinlenme günü de antrenmanın parçası. Kasların bugün güçleniyor! Proteini ve suyu tamamla, yarına hazır ol. 💪`,
      `Bugün toparlanma günü. Hafif bir yürüyüş, iyi bir uyku, ve yarın daha güçlü dönüyorsun! ✨`,
      `Her gün küçük bir adım: kaydını gir, suyunu iç, erken yat. Tutarlılık seni hedefe taşıyacak! 🎯`])
  }
  cand.sort((a, b) => b.weight - a.weight)
  return { key: cand[0].key, text: cand[0].text }
}
