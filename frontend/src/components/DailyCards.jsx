// Taşyürek Method: three Home cards — the message of the day (lib/daily-message.js), this week
// against the coach's weekly targets with the cardio log, and today's supplements (lib/daily.js).
import { useState, useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO, fmtNum, isoOf } from '../lib/format.js'
import { dailyMessage } from '../lib/daily-message.js'
import { CARDIO_TYPES, cardioLabel, cardioOf, addCardio, removeCardio, weekProgress, supplementPlan, suppItems, takenOn, toggleSupp } from '../lib/daily.js'
import Icon from './Icon.jsx'
import { Button, NumberField, Section, Row, Check } from './ui.jsx'
import './nutrition.css'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return isoOf(d) }

/* ---- message of the day ---- */

export function DailyMessageCard() {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const update = useStore(s => s.update)
  const today = todayISO()
  if (S.msgHidden === today) return null
  const m = dailyMessage(S, today, user?.name || '')
  if (!m) return null
  return <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
    <span className="lrow-i" style={{ background: 'color-mix(in srgb, var(--acc) 18%, transparent)', color: 'var(--acc)', flex: 'none' }}><Icon name="sparkles" /></span>
    <div className="grow" style={{ minWidth: 0 }}>
      <div className="lbl2">Günün notu</div>
      <div style={{ lineHeight: 1.45, marginTop: 2 }}>{m.text}</div>
    </div>
    <button className="iconbtn" aria-label="Bugünlük kapat" onClick={() => update(s => { s.msgHidden = today })} style={{ flex: 'none' }}><Icon name="xmark" /></button>
  </div>
}

/* ---- this week + cardio ---- */

// One activity ring: fills toward the weekly target, turns green with a tick when it is met.
function WeekRing({ label, have, want, unit, color, shown }) {
  const R = 40, C = 2 * Math.PI * R
  const pct = want ? Math.min(1, have / want) : 0
  const done = want > 0 && have >= want
  const stroke = done ? 'var(--green)' : color
  return <div className="wk-ring" role="img" aria-label={`${label}: ${have}${want ? ' / ' + want : ''}${unit || ''}`}>
    <div className="wk-ring-svg">
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={R} fill="none" strokeWidth="10" className="wk-trk" />
        {want > 0 && <circle cx="50" cy="50" r={R} fill="none" strokeWidth="10" strokeLinecap="round" className="wk-fill"
          stroke={stroke} strokeDasharray={C} strokeDashoffset={C * (1 - (shown ? pct : 0))} />}
      </svg>
      <div className="wk-ring-c">
        <b>{fmtNum(have)}</b>
        <span>{want ? `/ ${fmtNum(want)}${unit || ''}` : unit ? unit.trim() : 'hedef yok'}</span>
      </div>
    </div>
    <div className={'wk-ring-l' + (done ? ' done' : '')}>{label}{done ? ' ✓' : ''}</div>
  </div>
}

const DAY_SHORT = ['Pz', 'Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct']

// The week day by day: a mark for a training session, a column for cardio minutes.
function WeekStrip({ perDay, shown }) {
  const top = Math.max(30, ...perDay.map(x => x.minutes))
  return <div className="wk-strip">
    {perDay.map(x => {
      const dow = new Date(x.d + 'T12:00:00').getDay()
      const h = x.minutes ? Math.max(10, (x.minutes / top) * 100) : 0
      return <div key={x.d} className={'wk-day' + (x.today ? ' today' : '') + (x.future ? ' future' : '')}
        title={`${DAY_SHORT[dow]}: ${x.workouts ? x.workouts + ' antrenman' : 'antrenman yok'}${x.minutes ? `, ${x.minutes} dk kardiyo` : ''}`}>
        <span className={'wk-mark' + (x.workouts ? ' on' : '')}>{x.workouts ? <Icon name="dumbbell" /> : null}</span>
        <div className="wk-col"><div style={{ height: (shown ? h : 0) + '%' }} /></div>
        <span className="wk-min">{x.minutes ? x.minutes + '′' : ''}</span>
        <span className="wk-dl">{DAY_SHORT[dow]}</span>
      </div>
    })}
  </div>
}

export function WeekCard() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const today = todayISO()
  const w = weekProgress(S, today)
  const t = w.targets
  const todays = cardioOf(S, today)
  // Fill from empty once on arrival, so the rings read as progress rather than a static figure.
  const [shown, setShown] = useState(false)
  useEffect(() => { const id = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(id) }, [])
  return <div className="card nut">
    <div className="row between" style={{ marginBottom: 12 }}>
      <div><h2 style={{ margin: 0 }}>Bu hafta</h2><div className="small muted">{w.daysLeft ? `${w.daysLeft} gün kaldı` : 'Haftanın son günü'}</div></div>
      <Button size="sm" variant="tinted" icon="plus" onClick={() => cardioSheet()}>Kardiyo ekle</Button>
    </div>
    <div className="wk-rings">
      <WeekRing label="Antrenman" have={w.workouts} want={t.workouts} color="var(--acc)" shown={shown} />
      <WeekRing label="Kardiyo" have={w.sessions} want={t.sessions} color="var(--blue)" shown={shown} />
      <WeekRing label="Kardiyo süresi" have={w.minutes} want={t.minutes} unit=" dk" color="var(--teal)" shown={shown} />
    </div>
    <WeekStrip perDay={w.perDay} shown={shown} />
    {todays.length > 0 && <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--sep-op)' }}>
      <div className="small muted" style={{ marginBottom: 4 }}>Bugünkü kardiyo</div>
      {todays.map(c => <div key={c.id} className="row between" style={{ padding: '3px 0' }}>
        <span>{cardioLabel(c.type)} · <b>{c.min} dk</b></span>
        <button className="iconbtn" aria-label={'Sil: ' + cardioLabel(c.type)} onClick={() => update(s => removeCardio(s, today, c.id))}><Icon name="trash" /></button>
      </div>)}
    </div>}
    {!t.workouts && !t.sessions && !t.minutes && <div className="nut-note">Koçun haftalık hedef belirlediğinde halkalar hedefe göre dolacak.</div>}
  </div>
}

function CardioSheet({ close }) {
  const update = useStore(s => s.update)
  const [type, setType] = useState('Walking')
  const [min, setMin] = useState(30)
  const [day, setDay] = useState(todayISO())
  const save = () => {
    let it = null
    update(s => { it = addCardio(s, day, { type, min }) })
    if (!it) { toast('Süreyi dakika olarak gir'); return }
    close(); toast(`${cardioLabel(type)} ${it.min} dk eklendi`)
  }
  return <>
    <h3>Kardiyo ekle</h3>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
      {CARDIO_TYPES.map(([k, l]) => <button key={k} className={'chip nocap' + (type === k ? ' on' : '')} onClick={() => setType(k)}>{l}</button>)}
    </div>
    <Section>
      <Row title="Süre">
        <NumberField value={min} onChange={setMin} className="nut-num" aria-label="Süre (dk)" />
        <span className="small dim" style={{ marginInlineStart: 6 }}>dk</span>
      </Row>
    </Section>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '-4px 0 12px' }}>
      {[15, 20, 30, 45, 60].map(m => <button key={m} className={'chip nocap' + (Number(min) === m ? ' on' : '')} onClick={() => setMin(m)}>{m} dk</button>)}
    </div>
    <div className="row" style={{ gap: 6, marginBottom: 14 }}>
      <button className={'chip nocap' + (day === todayISO() ? ' on' : '')} onClick={() => setDay(todayISO())}>Bugün</button>
      <button className={'chip nocap' + (day === yesterday() ? ' on' : '')} onClick={() => setDay(yesterday())}>Dün</button>
    </div>
    <Button variant="primary" icon="plus" onClick={save}>Ekle</Button>
    <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={close}>Vazgeç</Button>
  </>
}
export const cardioSheet = () => ui().openSheet(close => <CardioSheet close={close} />)

/* ---- supplements ---- */

export function SupplementsCard() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const today = todayISO()
  const groups = supplementPlan(S)
  if (!groups.length) return null
  const on = takenOn(S, today)
  const total = suppItems(S).length
  const done = suppItems(S).filter(i => on[i.id]).length
  return <div className="card" style={{ padding: '14px 0 6px' }}>
    <div className="row between" style={{ padding: '0 16px', marginBottom: 6 }}>
      <h2 style={{ margin: 0 }}>Takviyeler</h2>
      <span className="small" style={{ fontWeight: 600, color: done === total ? 'var(--green)' : 'var(--label-2)' }}>{done}/{total}</span>
    </div>
    {groups.map(g => <div key={g.id}>
      <div className="small muted" style={{ padding: '8px 16px 2px' }}>{g.label}</div>
      {g.items.map(i => <div key={i.id} className="item" style={{ cursor: 'pointer', background: 'transparent' }} onClick={() => update(s => toggleSupp(s, today, i.id))}>
        <Check checked={!!on[i.id]} onChange={() => update(s => toggleSupp(s, today, i.id))} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="tt" style={on[i.id] ? { color: 'var(--label-2)' } : undefined}>{i.name}</div>
          {i.dose && <div className="ss">{i.dose}</div>}
        </div>
      </div>)}
    </div>)}
  </div>
}
