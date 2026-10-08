// Taşyürek Method: the member's membership on Home — days left, how much of it is used, coloured as
// the tracker did — and, from three days before the end, a reminder once a day. Dates come from the
// coach (state.coachMembership, lib/membership.js).
import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { daysLeft, levelOf, colorOf, memberText, progressOf } from '../lib/membership.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

function Reminder({ n, renewal, close }) {
  return <>
    <div style={{ textAlign: 'center', padding: '6px 4px 2px' }}>
      <div style={{ fontSize: 40, marginBottom: 6 }}>🗓️</div>
      <h3 style={{ marginBottom: 8 }}>{n < 0 ? 'Üyeliğin sona erdi' : n === 0 ? 'Üyeliğin bugün sona eriyor' : `Üyeliğinin bitmesine ${n} gün kaldı`}</h3>
      <div className="muted" style={{ lineHeight: 1.5, marginBottom: 18 }}>
        {n < 0 ? `Üyeliğin ${fmtDate(renewal, true)} tarihinde sona erdi.` : `Yenileme tarihin: ${fmtDate(renewal, true)}.`} Kaldığın yerden kesintisiz devam etmek için koçunla iletişime geç. 💪
      </div>
    </div>
    <Button variant="primary" onClick={close}>Tamam</Button>
  </>
}

export default function MembershipCard() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const m = S.coachMembership
  const today = todayISO()
  const n = daysLeft(m, today)
  const level = levelOf(n)
  // From three days before the end: a reminder, once a day.
  useEffect(() => {
    if (level !== 'urgent' || S.membershipNoticeOn === today) return
    const t = setTimeout(() => {
      update(s => { s.membershipNoticeOn = today })
      useUI.getState().openSheet(close => <Reminder n={n} renewal={m.renewal} close={close} />)
    }, 1200)
    return () => clearTimeout(t)
  }, [level, today, S.membershipNoticeOn])
  if (n === null) return null
  const color = colorOf(level)
  const p = progressOf(m, today)
  return <div className="card" style={{ padding: '12px 14px', borderLeft: `3px solid ${color}` }}>
    <div className="row between" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8, minWidth: 0 }}>
        <Icon name="calendar" style={{ color, flex: 'none' }} />
        <span style={{ fontWeight: 600, color: level === 'ok' ? undefined : color }}>{memberText(n)}</span>
      </div>
      <span className="small muted" style={{ flex: 'none' }}>{fmtDate(m.renewal)}</span>
    </div>
    {p !== null && <div className="nut-bar" style={{ marginTop: 8 }}><div style={{ width: Math.round(p * 100) + '%', background: color }} /></div>}
  </div>
}
