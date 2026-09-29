// Taşyürek Method: the message of the day on Home — built from the member's own numbers, never
// generic. Each rule looks at one thing (this week's sessions, yesterday's protein, sleep, cardio…)
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
    `Bugünkü antrenman tamam. Şimdi sıra toparlanmada: proteini tamamla, uykunu ihmal etme.`,
    `Antrenmanı bitirdin${hi ? ', ' + hi : ''}. Gelişim salonda başlar, yemek ve uykuyla tamamlanır.`,
    `Bugünün işi bitti. Akşam proteini ve suyu tamamlarsan günü tam puanla kapatırsın.`])

  if (!trainedToday && need > 0 && need >= daysInclToday - 1) add('week-behind', 80, [
    `Haftanın bitmesine ${daysInclToday} gün var, ${need} antrenman kaldı.${routine ? ` Bugün planında „${routine}" var.` : ''} Bugün başlamak için iyi bir gün.`,
    `Bu hafta ${wk.workouts}/${wk.targets.workouts} antrenman. Hedefe ${need} seans kaldı, ${daysInclToday} gün var.${routine ? ` Bugün: „${routine}".` : ''}`])

  // protein, the last two days
  const days2 = [addDays(today, -1), addDays(today, -2)].map(d => ({ d, t: totalsOf(dayOf(S, d)), g: macroTargetFor(S, d) }))
  const logged2 = days2.filter(x => x.t.kcal > 0 && x.g?.p)
  if (logged2.length === 2 && logged2.every(x => x.t.p < x.g.p * 0.85)) {
    const avgP = (logged2[0].t.p + logged2[1].t.p) / 2, avgT = (logged2[0].g.p + logged2[1].g.p) / 2
    add('protein-low', 75, [
      `Son iki gün protein hedefinin altında kaldı (ortalama ${f0(avgP)}/${f0(avgT)} g). Her öğüne bir protein kaynağı eklemek açığı kapatır.`,
      `Protein son iki gün ${f0(avgT - avgP)} g eksik kaldı. Kahvaltıya yumurta ya da yoğurt, ara öğüne süt ürünü eklemek kolay bir başlangıç.`])
  }

  // yesterday's log
  const yT = totalsOf(dayOf(S, y)), yG = macroTargetFor(S, y)
  const everLogged = Object.values(S.nutrition || {}).some(d => totalsOf(d).kcal > 0)
  if (everLogged && yT.kcal === 0) add('no-log-yesterday', 70, [
    `Dün beslenme kaydı yok. Sorun değil, bugün ilk öğünü girerek yeniden başla.`,
    `Dünü atladık. Kayıt tutmak mükemmel olmak değil, düzenli olmak demek. Bugün ilk öğünle devam.`])
  else if (yG && yT.kcal > 0 && Math.abs(yT.kcal - yG.kcal) <= yG.kcal * 0.07 && yT.p >= yG.p * 0.95) add('hit-yesterday', 50, [
    `Dün hedefi tutturdun: ${f0(yT.kcal)}/${f0(yG.kcal)} kcal, protein ${f0(yT.p)} g. Aynı ritimle devam${hi ? ', ' + hi : ''}.`,
    `Dünkü beslenme tam isabet (${f0(yT.kcal)} kcal, ${f0(yT.p)} g protein). Tutarlılık sonucu getiren şey.`])

  // sleep, the last three nights
  const sleeps = [1, 2, 3].map(i => Number(dayOf(S, addDays(today, -i))?.sleep) || 0).filter(x => x > 0)
  if (T?.sleep && sleeps.length >= 2) {
    const avg = sleeps.reduce((a, b) => a + b, 0) / sleeps.length
    if (avg < T.sleep - 1) add('sleep-low', 65, [
      `Son gecelerde ortalama ${f1(avg)} saat uyudun, hedefin ${f1(T.sleep)}. Toparlanma antrenman kadar önemli. Bu akşam yarım saat erken yatmayı dene.`,
      `Uyku son günlerde ${f1(T.sleep - avg)} saat eksik gidiyor. Kas gelişimi ve iştah kontrolü uykuyla doğrudan bağlantılı.`])
  }

  // cardio
  if (wk.targets.minutes && wk.minutes < wk.targets.minutes && wk.daysLeft <= 3) {
    const left = wk.targets.minutes - wk.minutes
    add('cardio-behind', 60, [
      `Bu hafta kardiyoda ${f0(wk.minutes)}/${f0(wk.targets.minutes)} dk. Kalan ${f0(left)} dakikayı ${daysInclToday} güne bölersen günde ${f0(left / daysInclToday)} dk yeter.`,
      `Kardiyo hedefine ${f0(left)} dk kaldı. Tempolu bir yürüyüş en kolay yolu.`])
  }

  if (!trainedToday && routine) add('training-day', 55, [
    `Bugün antrenman günü: „${routine}". ${T?.training ? 'Makroların antrenman günü hedefine göre.' : 'İyi antrenmanlar!'}`,
    `Planında bugün „${routine}" var. Isınmayı atlama, setlerini kaydetmeyi unutma.`])

  // logging streak
  let streak = 0
  for (let i = 1; i <= 60; i++) { if (totalsOf(dayOf(S, addDays(today, -i))).kcal > 0) streak++; else break }
  if (streak >= 5) add('streak', 45, [
    `${streak} gündür beslenmeni eksiksiz giriyorsun. Koçun için en değerli veri bu tutarlılık.`,
    `${streak} günlük kayıt serisi! Bu düzen, doğru ayarlamaları mümkün kılıyor.`])

  if (wk.targets.workouts && wk.workouts >= wk.targets.workouts) add('week-done', 40, [
    `Bu haftanın antrenman hedefi tamam (${wk.workouts}/${wk.targets.workouts}). Kalan günlerde beslenme ve uykuya odaklan.`,
    `Haftalık hedef tamamlandı: ${wk.workouts} antrenman. Harika iş${hi ? ', ' + hi : ''}.`])

  if (lastMeasurement(S) && measurementDue(S, today)) add('measure', 35, [
    `Haftalık ölçüm zamanı. Aynı saatte, aynı yerlerden ölçmek değişimi doğru gösterir.`])

  const sa = suppAdherence(S, today, 7)
  if (sa !== null && sa < 70) add('supps', 30, [
    `Son 7 günde takviyelerinin %${sa}'ini işaretledin. Sabah rutinine bağlamak hatırlamayı kolaylaştırır.`])

  if (!cand.length) {
    if (!T && !everLogged && !(S.workouts || []).length) return { key: 'welcome', text: `Hoş geldin${hi ? ', ' + hi : ''}! İlk adım: bugünün kilosunu ve ilk öğününü gir. Gerisini birlikte kuracağız.` }
    add('rest', 5, [
      `Bugün dinlenme günü. Kaslar dinlenirken gelişir. Proteini ve suyu yine tamamla.`,
      `Dinlenme günü de programın bir parçası. Hafif bir yürüyüş ve iyi bir uyku yeterli.`,
      `Her gün küçük bir adım: bugün kaydını tut, suyunu iç, erken yat.`])
  }
  cand.sort((a, b) => b.weight - a.weight)
  return { key: cand[0].key, text: cand[0].text }
}
