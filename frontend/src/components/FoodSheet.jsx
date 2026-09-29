// Taşyürek Method: adding what was eaten — search the food list, pick an amount, add it to a meal.
// Like FatSecret while the week lasts; when the week is over only the day's totals are kept
// (lib/nutrition-core.js). Foods: lib/foods.js.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { fmtNum } from '../lib/format.js'
import { MEALS, mealByHour, addFood, dayOf, totalsOf, weekStartIso } from '../lib/nutrition.js'
import { loadFoods, searchFoods, macrosFor, defaultQty, perLine, addSharedFood, fold } from '../lib/foods.js'
import Icon from './Icon.jsx'
import { Button, NumberField, Section, Row, Segmented, SearchField, TextField } from './ui.jsx'
import { dayLabel, addMacroSheet } from './NutritionCard.jsx'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const MEAL_OPTS = MEALS.map(([value, label]) => ({ value, label }))

// Foods added this week, newest first — the quickest way back to what one eats every day.
function recentFoods(S, list, iso) {
  const from = weekStartIso(iso, S.weekStart === 0 ? 0 : 1)
  const seen = new Set(), out = []
  const days = Object.entries(S.nutrition || {}).filter(([d]) => d >= from).sort((a, b) => (a[0] < b[0] ? 1 : -1))
  for (const [, day] of days) {
    for (const it of [...(day.items || [])].reverse()) {
      const key = it.fid || fold(it.n)
      if (!it.n || it.x || seen.has(key)) continue
      const food = list.find(f => f.id === it.fid) || list.find(f => fold(f.n) === fold(it.n))
      if (food) { seen.add(key); out.push(food) }
      if (out.length >= 12) return out
    }
  }
  return out
}

function Amount({ food, meal, iso, onDone, onBack }) {
  const update = useStore(s => s.update)
  const [qty, setQty] = useState(defaultQty(food))
  const m = macrosFor(food, qty || 0)
  const chips = food.u === 'g' ? [50, 100, 150, 200, 250] : [0.5, 1, 1.5, 2, 3]
  const add = () => {
    let ok = null
    update(s => { ok = addFood(s, iso, { meal, fid: food.id, name: food.n, qty, unit: food.u === 'g' ? 'g' : food.l, ...m }) })
    if (!ok) { toast('Miktar gir'); return }
    toast(`${food.n} eklendi · ${fmtNum(m.kcal)} kcal`)
    onDone()
  }
  return <>
    <button className="linkbtn small" onClick={onBack} style={{ marginBottom: 8 }}><Icon name="chevronLeft" /> Listeye dön</button>
    <h3 style={{ marginBottom: 2 }}>{food.n}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{perLine(food)}</div>
    <Section>
      <Row title="Miktar">
        <NumberField value={qty} onChange={setQty} className="nut-num" aria-label="Miktar" />
        <span className="small dim" style={{ marginInlineStart: 6, maxWidth: 120 }}>{food.u === 'g' ? 'g' : '× ' + food.l}</span>
      </Row>
    </Section>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '-4px 0 14px' }}>
      {chips.map(c => <button key={c} className={'chip nocap' + (Number(qty) === c ? ' on' : '')} onClick={() => setQty(c)}>{food.u === 'g' ? c + ' g' : fmtNum(c) + ' ×'}</button>)}
    </div>
    <div className="card" style={{ padding: '10px 14px', marginBottom: 14 }}>
      <div className="row between"><b>{fmtNum(m.kcal)} kcal</b><span className="small muted">P {fmtNum(m.p)} · K {fmtNum(m.c)} · Y {fmtNum(m.f)}</span></div>
    </div>
    <Button variant="primary" icon="plus" onClick={add}>{MEALS.find(x => x[0] === meal)[1]} öğününe ekle</Button>
  </>
}

function CreateFood({ initialName, onCreated, onBack }) {
  const [name, setName] = useState(initialName || '')
  const [unit, setUnit] = useState('100g')
  const [label, setLabel] = useState('1 porsiyon')
  const [v, setV] = useState({ protein: null, carbs: null, fat: null })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try { onCreated(await addSharedFood({ name, unit, portionLabel: label, ...v })) }
    catch (e) { toast(e.data?.error || e.message || 'Kaydedilemedi') }
    finally { setBusy(false) }
  }
  return <>
    <button className="linkbtn small" onClick={onBack} style={{ marginBottom: 8 }}><Icon name="chevronLeft" /> Listeye dön</button>
    <h3>Yeni yemek</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>Ortak listeye eklenir, herkes kullanabilir. Değerleri paketten ya da tariften gir.</div>
    <TextField placeholder="Yemeğin adı" value={name} onChange={e => setName(e.target.value)} maxLength={80} />
    <div style={{ height: 10 }} />
    <Segmented value={unit} onChange={setUnit} options={[{ value: '100g', label: '100 g için' }, { value: 'portion', label: 'Porsiyon için' }]} />
    <div style={{ height: 10 }} />
    {unit === 'portion' && <><TextField placeholder="Porsiyon (ör. 1 kase, 1 dilim)" value={label} onChange={e => setLabel(e.target.value)} maxLength={40} /><div style={{ height: 10 }} /></>}
    <Section>
      {[['protein', 'Protein'], ['carbs', 'Karbonhidrat'], ['fat', 'Yağ']].map(([k, l]) => <Row key={k} title={l}>
        <NumberField nullable value={v[k]} onChange={x => setV(o => ({ ...o, [k]: x }))} placeholder="0" className="nut-num" aria-label={l + ' (g)'} />
        <span className="small dim" style={{ marginInlineStart: 6 }}>g</span>
      </Row>)}
    </Section>
    <Button variant="primary" icon="checkCircle" disabled={busy} onClick={save}>{busy ? 'Kaydediliyor…' : 'Kaydet ve seç'}</Button>
  </>
}

function FoodSheet({ iso, close }) {
  const S = useStore(s => s.S)
  const [meal, setMeal] = useState(mealByHour())
  const [q, setQ] = useState('')
  const [list, setList] = useState(null)
  const [picked, setPicked] = useState(null)
  const [creating, setCreating] = useState(false)
  const inputRef = useRef(null)
  useEffect(() => { let on = true; loadFoods({ refresh: true }).then(l => on && setList(l)).catch(() => on && setList([])); return () => { on = false } }, [])
  const results = useMemo(() => (list ? searchFoods(list, q, 60) : []), [list, q])
  const recent = useMemo(() => (list && !q ? recentFoods(S, list, iso) : []), [list, q, S, iso])
  const total = totalsOf(dayOf(S, iso))

  if (creating) return <CreateFood initialName={q} onBack={() => setCreating(false)}
    onCreated={f => { setList(l => [...(l || []), f]); setCreating(false); setPicked(f) }} />
  if (picked) return <Amount food={picked} meal={meal} iso={iso} onBack={() => setPicked(null)}
    onDone={() => { setPicked(null); setQ(''); setTimeout(() => inputRef.current?.focus(), 50) }} />

  const row = f => <Row key={f.id} title={f.n} subtitle={perLine(f)} accessory="chevron" onClick={() => setPicked(f)} />
  return <>
    <h3>Yemek ekle · {dayLabel(iso)}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>Bugüne kadar {fmtNum(total.kcal)} kcal · P {fmtNum(total.p)} · K {fmtNum(total.c)} · Y {fmtNum(total.f)}</div>
    <Segmented value={meal} onChange={setMeal} options={MEAL_OPTS} />
    <div style={{ height: 10 }} />
    <SearchField ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onClear={() => setQ('')} placeholder="Yemek ara (ör. tavuk, pilav, yumurta)" />
    <div style={{ height: 10 }} />
    {!list ? <div className="empty">Liste yükleniyor…</div> : <>
      {recent.length > 0 && <Section title="Bu hafta eklediklerin">{recent.map(row)}</Section>}
      <Section title={q ? `${results.length ? results.length : 'Sonuç yok'}${results.length === 60 ? '+' : ''}${results.length ? ' sonuç' : ''}` : 'Tüm yemekler'}>
        {results.map(row)}
      </Section>
    </>}
    <Section>
      <Row icon="plus" title="Listede yok mu? Yeni yemek ekle" accessory="chevron" onClick={() => setCreating(true)} />
      <Row icon="pencil" title="Sadece makro gir" subtitle="Gramları biliyorsan, yemeksiz" accessory="chevron" onClick={() => { close(); addMacroSheet(iso) }} />
    </Section>
    <Button variant="ghost" className="dim" onClick={close}>Bitti</Button>
  </>
}

export const foodSheet = iso => ui().openSheet(close => <FoodSheet iso={iso} close={close} />)
