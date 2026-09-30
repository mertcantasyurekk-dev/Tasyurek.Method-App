// Taşyürek Method: the Home nutrition card — today's kcal and macros against the coach's targets,
// water, and the way to put the day's numbers in. Only the day's totals are kept (lib/nutrition.js). Days can be stepped back so a missed evening is filled in
// the next morning. Data model and sums: lib/nutrition.js.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO, isoOf, fmtDate, fmtNum } from '../lib/format.js'
import { useCoached } from '../lib/coached.js'
import { cleanTargets } from '../lib/firebase-api.js'
import { dayOf, totalsOf, targetsOf, macroTargetFor, kcalOf, addToDay, setTotals, setWater, setSleep, setDayType, removeItem, mealsOf, signedSum, isClosedDay } from '../lib/nutrition.js'
import { foodSheet } from './FoodSheet.jsx'
import Icon from './Icon.jsx'
import { Button, NumberField, Section, Row, Segmented } from './ui.jsx'
import './nutrition.css'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const MACROS = [['p', 'Protein'], ['c', 'Karbonhidrat'], ['f', 'Yağ']]
const g = v => fmtNum(Math.round(v)) + ' g'
// Water moves in quarter litres: 1,75 L, not 1,8.
const liters = v => (Math.round((v || 0) * 100) / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })

const shift = (iso, days) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + days); return isoOf(d) }
export function dayLabel(iso, today = todayISO()) {
  if (iso === today) return 'Bugün'
  if (iso === shift(today, -1)) return 'Dün'
  return fmtDate(iso)
}

/* ------------------------------------------------------------------ ring ------------------------ */

function Ring({ totals, target }) {
  const R = 50, W = 11, C = 2 * Math.PI * R
  const kc = { p: totals.p * 4, c: totals.c * 4, f: totals.f * 9 }
  const whole = target ? Math.max(target.kcal, 1) : Math.max(totals.kcal, 1)
  let at = 0
  const segs = MACROS.map(([k]) => {
    const len = Math.max(0, Math.min(C - at, (kc[k] / whole) * C))
    const s = { k, len, off: -at }; at += len; return s
  })
  const over = target && totals.kcal > target.kcal * 1.05
  const left = target ? target.kcal - totals.kcal : null
  return <div className="nut-ring" role="img" aria-label={`${totals.kcal} kcal${target ? ' / ' + target.kcal : ''}`}>
    <svg viewBox="0 0 120 120">
      <circle className="trk" cx="60" cy="60" r={R} fill="none" strokeWidth={W} />
      {segs.map(s => s.len > 0.5 && <circle key={s.k} className="seg" cx="60" cy="60" r={R} fill="none" strokeWidth={W}
        stroke={`var(--${s.k})`} strokeDasharray={`${s.len} ${C}`} strokeDashoffset={s.off} />)}
    </svg>
    <div className="nut-ring-c">
      <b className={over ? 'over' : ''}>{fmtNum(totals.kcal)}</b>
      <span>{target ? `/ ${fmtNum(target.kcal)} kcal` : 'kcal'}</span>
      {left != null && <span className={over ? 'over' : ''}>{left >= 0 ? `${fmtNum(left)} kaldı` : `${fmtNum(-left)} fazla`}</span>}
    </div>
  </div>
}

function MacroRow({ k, name, have, want }) {
  const pct = want ? Math.min(100, (have / want) * 100) : 0
  const diff = want ? want - have : null
  const cls = diff == null ? '' : Math.abs(diff) <= want * 0.05 ? 'hit' : diff < 0 ? 'over' : ''
  return <div className="nut-row">
    <div className="nut-row-t">
      <span className="nm"><i style={{ background: `var(--${k})` }} />{name}</span>
      <span className="vl"><b>{fmtNum(Math.round(have))}</b>{want ? ` / ${fmtNum(want)} g` : ' g'}</span>
    </div>
    {want > 0 && <>
      <div className="nut-bar"><div style={{ width: pct + '%', background: `var(--${k})` }} /></div>
      <div className={'nut-left ' + cls}>{cls === 'hit' ? 'Hedefte' : diff >= 0 ? `${g(diff)} kaldı` : `${g(-diff)} fazla`}</div>
    </>}
  </div>
}

/* ------------------------------------------------------------------ card ------------------------ */

export default function NutritionCard() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const coached = useCoached()
  const [iso, setIso] = useState(todayISO())
  const today = todayISO()
  const day = dayOf(S, iso)
  const totals = totalsOf(day)
  const target = macroTargetFor(S, iso)
  const T = targetsOf(S)
  const water = day?.water || 0
  const wantWater = T?.water || 0
  const steps = wantWater ? Math.round(wantWater / 0.25) : 0

  const flipType = () => update(s => setDayType(s, iso, target.type === 'training' ? 'rest' : 'training'))

  return <div className="card nut">
    <div className="nut-hd">
      <div className="nut-date">
        <button className="iconbtn" aria-label="Önceki gün" onClick={() => setIso(shift(iso, -1))}><Icon name="chevronLeft" /></button>
        <span className="nut-day">{dayLabel(iso, today)}</span>
        <button className="iconbtn" aria-label="Sonraki gün" disabled={iso >= today} onClick={() => setIso(shift(iso, 1))}><Icon name="chevronRight" /></button>
      </div>
      {target?.type && <button className={'nut-type' + (target.type === 'rest' ? ' rest' : '')} onClick={flipType}
        title="Gün tipini değiştir">{target.type === 'training' ? 'Antrenman günü' : 'Dinlenme günü'}</button>}
    </div>

    <div className="nut-body">
      <Ring totals={totals} target={target} />
      <div className="nut-m">
        {MACROS.map(([k, name]) => <MacroRow key={k} k={k} name={name} have={totals[k]} want={target?.[k] || 0} />)}
      </div>
    </div>

    <div className="nut-water">
      <Icon name="drop" />
      <div className="grow">
        <div className="ttl">Su</div>
        <div className="ss">{liters(water)}{wantWater ? ` / ${liters(wantWater)}` : ''} L</div>
        {steps > 0 && steps <= 24 && <div className="nut-drops">{Array.from({ length: steps }, (_, i) =>
          <span key={i} className={i < Math.round(water / 0.25) ? 'on' : ''} />)}</div>}
      </div>
      <button className="iconbtn" aria-label="Su azalt" disabled={water <= 0} onClick={() => update(s => setWater(s, iso, water - 0.25))}><Icon name="minus" /></button>
      <button className="iconbtn" aria-label="Su ekle" onClick={() => update(s => setWater(s, iso, water + 0.25))}><Icon name="plus" /></button>
    </div>

    <div className="nut-act">
      <Button size="sm" variant="tinted" icon="plus" onClick={() => foodSheet(iso)}>Yemek ekle</Button>
      <Button size="sm" icon="fork" onClick={() => dayEditSheet(iso)}>Günün öğünleri</Button>
    </div>
    {coached
      ? !T && <div className="nut-note">Koçun henüz beslenme hedefini belirlemedi. Girdiklerin yine de kaydedilir.</div>
      : <div className="nut-note"><a href="#" onClick={e => { e.preventDefault(); myTargetsSheet() }}>{T ? 'Hedeflerimi düzenle' : 'Kendi hedeflerini belirle'}</a></div>}
  </div>
}

/* ------------------------------------------------------------------ sheets ---------------------- */

function MacroFields({ v, set, placeholder = '0' }) {
  return <Section>
    {MACROS.map(([k, label]) => <Row key={k} title={label}>
      <NumberField nullable value={v[k]} onChange={x => set(o => ({ ...o, [k]: x }))} placeholder={placeholder} className="nut-num" aria-label={label + ' (g)'} />
      <span className="small dim" style={{ marginInlineStart: 6 }}>g</span>
    </Row>)}
  </Section>
}

// After a meal: its grams go onto the day's totals. Nothing about the meal itself is kept.
function AddMacro({ iso, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [v, setV] = useState({ p: null, c: null, f: null })
  const kcal = kcalOf({ p: v.p || 0, c: v.c || 0, f: v.f || 0 })
  const now = totalsOf(dayOf(S, iso))
  const save = () => {
    let ok = false
    update(s => { ok = addToDay(s, iso, v) })
    if (!ok) { toast('En az bir makro gir'); return }
    close(); toast(`${fmtNum(kcal)} kcal eklendi`)
  }
  return <>
    <h3>Makro ekle · {dayLabel(iso)}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>Yediğinin gramlarını gir, günün toplamına eklenir. Şu an: {fmtNum(now.kcal)} kcal · P {fmtNum(now.p)} · K {fmtNum(now.c)} · Y {fmtNum(now.f)}</div>
    <MacroFields v={v} set={setV} />
    <div className="row between" style={{ margin: '4px 2px 14px' }}><span className="muted">Eklenecek</span><b>{fmtNum(kcal)} kcal</b></div>
    <Button variant="primary" icon="plus" onClick={save}>Ekle</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>Vazgeç</Button>
  </>
}
export const addMacroSheet = iso => ui().openSheet(close => <AddMacro iso={iso} close={close} />)

// The day: its meals this week (each item can be removed), the totals put right, sleep, day type.
function DayEdit({ iso, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const day = dayOf(S, iso)
  const cur = totalsOf(day)
  const target = macroTargetFor(S, iso)
  const T = targetsOf(S)
  const meals = mealsOf(day)
  const closed = isClosedDay(S, iso)
  const [fix, setFix] = useState(false)
  const [v, setV] = useState({ p: cur.p || null, c: cur.c || null, f: cur.f || null })
  const kcal = kcalOf({ p: v.p || 0, c: v.c || 0, f: v.f || 0 })
  const saveFix = () => { update(s => setTotals(s, iso, { p: v.p || 0, c: v.c || 0, f: v.f || 0 })); setFix(false); toast('Toplam düzeltildi') }
  const itemLine = it => `${fmtNum(kcalOf({ p: Math.max(0, it.p), c: Math.max(0, it.c), f: Math.max(0, it.f) }))} kcal · P ${fmtNum(it.p)} · K ${fmtNum(it.c)} · Y ${fmtNum(it.f)}`
  const qtyLine = it => (it.x ? '' : it.u === 'g' ? `${fmtNum(it.q)} g · ` : it.u ? `${fmtNum(it.q)} × ${it.u} · ` : '')
  return <>
    <h3>{dayLabel(iso)} · öğünler</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{fmtNum(cur.kcal)} kcal{target ? ` / ${fmtNum(target.kcal)}` : ''} · P {fmtNum(cur.p)} · K {fmtNum(cur.c)} · Y {fmtNum(cur.f)}</div>
    {target?.type && <><Segmented value={target.type} onChange={x => update(s => setDayType(s, iso, x))}
      options={[{ value: 'training', label: 'Antrenman günü' }, { value: 'rest', label: 'Dinlenme günü' }]} /><div style={{ height: 12 }} /></>}
    {closed && !meals.length && <div className="card small muted" style={{ marginBottom: 12 }}>Bu hafta kapandı. Öğün detayı saklanmaz, sadece günün toplamı durur.</div>}
    {meals.map(g => {
      const sum = signedSum(g.items)
      return <Section key={g.key} title={<span className="nut-meal-h">{g.label} <small>{fmtNum(kcalOf({ p: Math.max(0, sum.p), c: Math.max(0, sum.c), f: Math.max(0, sum.f) }))} kcal</small></span>}>
        {g.items.map(it => <Row key={it.id} title={it.n || 'Hızlı ekleme'} subtitle={qtyLine(it) + itemLine(it)}>
          <button className="iconbtn" aria-label={'Sil: ' + (it.n || '')} onClick={() => update(s => removeItem(s, iso, it.id))}><Icon name="trash" /></button>
        </Row>)}
      </Section>
    })}
    {!closed && !meals.length && <div className="empty small">Bu gün için henüz yemek eklemedin.</div>}
    <Button variant="primary" icon="plus" onClick={() => { close(); foodSheet(iso) }}>Yemek ekle</Button>
    <div style={{ height: 14 }} />
    {!fix ? <Section><Row icon="pencil" title="Günün toplamını düzelt" subtitle="Yanlış ya da eksik girdiysen" accessory="chevron" onClick={() => setFix(true)} /></Section> : <>
      <MacroFields v={v} set={setV} />
      <div className="row between" style={{ margin: '4px 2px 10px' }}><span className="muted">Yeni toplam</span><b>{fmtNum(kcal)} kcal</b></div>
      <Button icon="checkCircle" onClick={saveFix}>Toplamı kaydet</Button>
      <div style={{ height: 14 }} />
    </>}
    <Section title="Uyku">
      <Row icon="moon" title="Uyku" subtitle={T?.sleep ? `Hedef ${fmtNum(T.sleep)} saat` : undefined}>
        <button className="iconbtn" aria-label="Uyku azalt" onClick={() => update(s => setSleep(s, iso, (day?.sleep || 0) - 0.5))}><Icon name="minus" /></button>
        <b style={{ minWidth: 56, textAlign: 'center' }}>{day?.sleep ? fmtNum(day.sleep) + ' sa' : '—'}</b>
        <button className="iconbtn" aria-label="Uyku artır" onClick={() => update(s => setSleep(s, iso, (day?.sleep || (T?.sleep ? T.sleep - 0.5 : 7)) + 0.5))}><Icon name="plus" /></button>
      </Row>
    </Section>
    <Button variant="ghost" className="dim" onClick={close}>Kapat</Button>
  </>
}
export const dayEditSheet = iso => ui().openSheet(close => <DayEdit iso={iso} close={close} />)

/* ------------------------------------------------------------------ targets form ---------------- */
// Shared by the coach panel (a member's targets) and the coach's own card (S.myTargets).

export function TargetsForm({ initial, onSave, busy, saveLabel = 'Hedefleri kaydet' }) {
  const pick = (set, k) => (set && set[k] != null ? Number(set[k]) : null)
  const [t, setT] = useState(() => ({
    training: { p: pick(initial?.training, 'p'), c: pick(initial?.training, 'c'), f: pick(initial?.training, 'f') },
    rest: { p: pick(initial?.rest, 'p'), c: pick(initial?.rest, 'c'), f: pick(initial?.rest, 'f') },
    water: initial?.water ?? null, sleep: initial?.sleep ?? null,
    workoutsPerWeek: initial?.workoutsPerWeek ?? null, cardioSessionsPerWeek: initial?.cardioSessionsPerWeek ?? null, cardioMinutesPerWeek: initial?.cardioMinutesPerWeek ?? null
  }))
  const setM = (which, k, v) => setT(o => ({ ...o, [which]: { ...o[which], [k]: v } }))
  const kc = s => kcalOf({ p: s.p || 0, c: s.c || 0, f: s.f || 0 })
  const block = (which, title) => <Section title={title} footer={kc(t[which]) ? `${fmtNum(kc(t[which]))} kcal` : 'Boş bırakırsan bu gün tipi için ayrı hedef olmaz.'}>
    {MACROS.map(([k, label]) => <Row key={k} title={label}>
      <NumberField nullable value={t[which][k]} onChange={v => setM(which, k, v)} placeholder="—" className="nut-num" aria-label={`${title} ${label} (g)`} />
      <span className="small dim" style={{ marginInlineStart: 6 }}>g</span>
    </Row>)}
  </Section>
  const save = () => {
    try { onSave(cleanTargets(t)) } catch (e) { toast(e.data?.error || e.message) }
  }
  return <>
    {block('training', 'Antrenman günü')}
    {block('rest', 'Dinlenme günü')}
    <Section title="Günlük">
      <Row icon="drop" title="Su"><NumberField nullable value={t.water} onChange={v => setT(o => ({ ...o, water: v }))} placeholder="—" className="nut-num sm" aria-label="Su (L)" /><span className="small dim" style={{ marginInlineStart: 6 }}>L</span></Row>
      <Row icon="moon" title="Uyku"><NumberField nullable value={t.sleep} onChange={v => setT(o => ({ ...o, sleep: v }))} placeholder="—" className="nut-num sm" aria-label="Uyku (saat)" /><span className="small dim" style={{ marginInlineStart: 6 }}>sa</span></Row>
    </Section>
    <Section title="Haftalık" footer={'Üyenin ana sayfasındaki „Bu hafta" kartında ilerleme olarak görünür.'}>
      <Row icon="dumbbell" title="Antrenman"><NumberField nullable value={t.workoutsPerWeek} onChange={v => setT(o => ({ ...o, workoutsPerWeek: v }))} placeholder="—" className="nut-num sm" aria-label="Haftalık antrenman" /><span className="small dim" style={{ marginInlineStart: 6 }}>seans</span></Row>
      <Row icon="figureRun" title="Kardiyo"><NumberField nullable value={t.cardioSessionsPerWeek} onChange={v => setT(o => ({ ...o, cardioSessionsPerWeek: v }))} placeholder="—" className="nut-num sm" aria-label="Haftalık kardiyo seansı" /><span className="small dim" style={{ marginInlineStart: 6 }}>seans</span></Row>
      <Row icon="timer" title="Kardiyo süresi"><NumberField nullable value={t.cardioMinutesPerWeek} onChange={v => setT(o => ({ ...o, cardioMinutesPerWeek: v }))} placeholder="—" className="nut-num sm" aria-label="Haftalık kardiyo dakikası" /><span className="small dim" style={{ marginInlineStart: 6 }}>dk</span></Row>
    </Section>
    <Button variant="primary" icon="checkCircle" disabled={busy} onClick={save}>{busy ? 'Kaydediliyor…' : saveLabel}</Button>
  </>
}

function MyTargets({ close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  return <>
    <h3>Beslenme hedeflerin</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>Kendi antrenmanın için. Üyelerin hedeflerini Koç panelinden belirlersin.</div>
    <TargetsForm initial={S.myTargets} onSave={t => { update(s => { s.myTargets = t }); close(); toast('Hedefler kaydedildi') }} />
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>Vazgeç</Button>
  </>
}
export const myTargetsSheet = () => ui().openSheet(close => <MyTargets close={close} />)
