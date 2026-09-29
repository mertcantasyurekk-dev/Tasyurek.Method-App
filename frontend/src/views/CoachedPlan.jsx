// Taşyürek Method: the Plan tab for a coached member. The coach's program, read-only: which day
// is which routine, and what each routine asks for. Tapping an exercise shows how it is done;
// tapping Start starts that routine. Nothing here edits anything.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { exOr } from '../lib/exercises.js'
import { DAYN, weekOrder, weekStartOf, exCount } from '../lib/format.js'
import { t, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { exLine } from '../lib/history.js'
import { speedUnitOf } from '../lib/speed.js'
import { Thumb } from '../components/Media.jsx'
import { exerciseDetailSheet, startFlow } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { Button } from '../components/ui.jsx'

function RoutineCard({ r, open, onToggle, S }) {
  return <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
    <div className="item" style={{ cursor: 'pointer' }} onClick={onToggle}>
      <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
      <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
      <Icon name={open ? 'chevronUp' : 'chevronDown'} className="chev" />
    </div>
    {open && <div style={{ padding: '0 14px 14px' }}>
      {r.ex.map((e, i) => {
        const ex = exOr(e.id)
        return <div key={i} className="row" style={{ gap: 10, padding: '8px 0', borderTop: '1px solid var(--sep)', cursor: 'pointer' }}
          onClick={() => exerciseDetailSheet(ex)}>
          <Thumb ex={ex} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className={`tt ${exerciseNameClass(ex)}`}>{exerciseNameFor(ex)}</div>
            <div className="ss">{exLine(e, S.unit, speedUnitOf(S))}</div>
            {e.note && <div className="small dim" style={{ marginTop: 2 }}>{e.note}</div>}
          </div>
        </div>
      })}
      <div style={{ height: 6 }} />
      <Button variant="primary" icon="play" onClick={() => startFlow([r.id])} disabled={!!S.active}>{t('Start {0}', r.name)}</Button>
    </div>}
  </div>
}

export default function CoachedPlan() {
  const S = useStore(s => s.S)
  const [open, setOpen] = useState(null)
  const byId = id => S.routines.find(r => r.id === id)

  return <>
    <div className="hdr"><div><h1>Programım</h1><div className="sub">Koçunun hazırladığı program</div></div></div>
    {!S.routines.length ? <div className="empty"><div className="ico"><Icon name="clipboard" /></div>
      Koçun programını henüz yüklemedi.</div> : <div className="cols"><div>
      <h4 className="sec">{t('Week schedule')}</h4>
      <div className="list">
        {weekOrder(weekStartOf(S)).map(d => {
          const rs = [].concat(S.week[d] || []).map(byId).filter(Boolean)
          return <div key={d} className="item">
            <div className="grow"><div className="tt">{t(DAYN[d])}</div>
              {rs.length > 0 && <div className="ss">{rs.map(r => r.name).join(' + ')}</div>}</div>
            {!rs.length && <span className="tag">{t('Rest')}</span>}
          </div>
        })}
      </div>
    </div><div>
      <h4 className="sec" style={{ marginTop: 22 }}>{t('Routines')}</h4>
      {S.routines.map(r => <RoutineCard key={r.id} r={r} S={S} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />)}
    </div></div>}
  </>
}
