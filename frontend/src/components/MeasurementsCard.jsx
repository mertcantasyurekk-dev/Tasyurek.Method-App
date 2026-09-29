// Taşyürek Method: body measurements on Home — each tape measurement now and how it moved, against
// the previous measurement or the first; entering a week's measurements with how-to hints; the
// history of one measurement as a curve. Model: lib/measurements.js.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO, fmtDate, fmtNum } from '../lib/format.js'
import { FIELDS, entriesOf, latestOf, changesOf, daysSinceLast, isDue, seriesOf, saveMeasurement, removeMeasurement, DUE_DAYS } from '../lib/measurements.js'
import LineChart from './LineChart.jsx'
import Icon from './Icon.jsx'
import { Button, NumberField, Section, Row, Segmented } from './ui.jsx'
import './nutrition.css'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const cm = v => fmtNum(Math.round(v * 10) / 10)
const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + cm(Math.abs(v))

function Delta({ v }) {
  if (v == null) return <span className="dim small">—</span>
  return <span className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: v === 0 ? 'var(--label-3)' : 'var(--label-2)' }}>
    {v !== 0 && <Icon name={v > 0 ? 'arrowUp' : 'arrowDown'} style={{ fontSize: 10, flex: 'none' }} />}<span>{signed(v)}</span>
  </span>
}

export default function MeasurementsCard() {
  const S = useStore(s => s.S)
  const [vs, setVs] = useState('prev')
  const today = todayISO()
  const ch = changesOf(S)
  const last = latestOf(S)
  const due = isDue(S, today)
  const ago = daysSinceLast(S, today)
  return <div className="card" style={due ? { boxShadow: 'inset 0 0 0 1.5px var(--acc)' } : undefined}>
    <div className="row between" style={{ marginBottom: 8 }}>
      <div>
        <h2 style={{ margin: 0 }}>Vücut ölçüleri</h2>
        <div className="small muted">{last ? `Son ölçüm ${fmtDate(last.d)}${ago ? ` · ${ago} gün önce` : ' · bugün'}` : 'Henüz ölçüm yok'}</div>
      </div>
      <Button size="sm" variant={due ? 'primary' : undefined} icon="plus" onClick={() => measureSheet()}>Ölç</Button>
    </div>
    {due && <div className="small" style={{ marginBottom: 10 }}><b>{last ? 'Haftalık ölçüm zamanı.' : 'İlk ölçümünü gir.'}</b> <span className="muted">Her hafta aynı gün, sabah ölçmek en tutarlısı.</span></div>}
    {ch && <>
      <Segmented value={vs} onChange={setVs} options={[{ value: 'prev', label: 'Önceki ölçüme göre' }, { value: 'first', label: 'Başlangıca göre' }]} />
      <div className="meas-grid">
        {FIELDS.filter(f => ch[f.key]).map(f => <button key={f.key} className="meas-cell" onClick={() => historySheet(f.key)}>
          <span className="small muted">{f.label}</span>
          <span><b>{cm(ch[f.key].v)}</b> <span className="small dim">cm</span></span>
          <Delta v={vs === 'prev' ? ch[f.key].dPrev : ch[f.key].dFirst} />
        </button>)}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
        <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => historySheet()}>Geçmiş</Button>
      </div>
    </>}
  </div>
}

/* ---- entering a day's measurements ---- */

function Measure({ close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [d, setD] = useState(todayISO())
  const existing = entriesOf(S).find(m => m.d === d)
  const last = latestOf(S)
  const [v, setV] = useState(() => Object.fromEntries(FIELDS.map(f => [f.key, existing?.[f.key] ?? null])))
  const pickDay = iso => {
    setD(iso)
    const e = entriesOf(S).find(m => m.d === iso)
    setV(Object.fromEntries(FIELDS.map(f => [f.key, e?.[f.key] ?? null])))
  }
  const save = () => {
    let saved = false
    update(s => { saved = saveMeasurement(s, d, v) })
    if (!saved) { toast('En az bir ölçü gir (10–250 cm)'); return }
    close(); toast('Ölçüler kaydedildi')
  }
  return <>
    <h3>Vücut ölçüleri</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>Mezurayı sıkmadan, cilde değecek şekilde tut. Hepsini girmek zorunda değilsin. Silik rakamlar son ölçümün.</div>
    <Row icon="calendar" title="Tarih">
      <input type="date" className="field" value={d} max={todayISO()} onChange={e => e.target.value && pickDay(e.target.value)} style={{ width: 'auto' }} />
    </Row>
    {existing && <div className="small muted" style={{ margin: '4px 2px 8px' }}>Bu tarihte kayıt var, kaydedince güncellenir.</div>}
    <Section>
      {FIELDS.map(f => <Row key={f.key} title={f.label} subtitle={f.hint}>
        <NumberField nullable decimal value={v[f.key]} onChange={x => setV(o => ({ ...o, [f.key]: x }))}
          placeholder={last?.[f.key] != null ? cm(last[f.key]) : '—'} className="nut-num" aria-label={f.label + ' (cm)'} />
        <span className="small dim" style={{ marginInlineStart: 6 }}>cm</span>
      </Row>)}
    </Section>
    <Button variant="primary" icon="checkCircle" onClick={save}>Kaydet</Button>
    <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={close}>Vazgeç</Button>
  </>
}
export const measureSheet = () => ui().openSheet(close => <Measure close={close} />)

/* ---- one measurement over time, and the entries ---- */

function History({ field: initial, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const ch = changesOf(S) || {}
  const fields = FIELDS.filter(f => ch[f.key])
  const [key, setKey] = useState(initial && ch[initial] ? initial : fields[0]?.key)
  const f = FIELDS.find(x => x.key === key)
  const pts = key ? seriesOf(S, key) : []
  const entries = [...entriesOf(S)].reverse()
  return <>
    <h3>Ölçüm geçmişi</h3>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
      {fields.map(x => <button key={x.key} className={'chip nocap' + (x.key === key ? ' on' : '')} onClick={() => setKey(x.key)}>{x.label}</button>)}
    </div>
    {f && <div className="card">
      <div className="row between"><b>{f.label}</b><span className="small muted">{pts.length} ölçüm · başlangıca göre {ch[key].dFirst == null ? '—' : signed(ch[key].dFirst) + ' cm'}</span></div>
      {pts.length > 1 ? <div className="chart" style={{ marginTop: 8 }}><LineChart points={pts} h={150} unit="cm" /></div>
        : <div className="small muted" style={{ marginTop: 8 }}>Grafik için en az iki ölçüm gerekli.</div>}
    </div>}
    <Section title="Ölçüm günleri">
      {entries.map(m => <Row key={m.d} title={fmtDate(m.d, true)}
        subtitle={FIELDS.filter(x => m[x.key] != null).map(x => `${x.label} ${cm(m[x.key])}`).join(' · ')}>
        <button className="iconbtn" aria-label={'Sil: ' + m.d} onClick={() => { update(s => removeMeasurement(s, m.d)); toast('Ölçüm silindi') }}><Icon name="trash" /></button>
      </Row>)}
    </Section>
    <Button variant="ghost" className="dim" onClick={close}>Kapat</Button>
  </>
}
export const historySheet = field => ui().openSheet(close => <History field={field} close={close} />)
