// Taşyürek Method: the coach's weekly messages on the member's side — the latest on Home, all of
// them one tap away. They come with the coach's plan (state.coachReviews, read-only). What was
// last opened is remembered in state.reviewsSeenAt, so a new message shows as new.
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { fmtDate } from '../lib/format.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

const when = iso => (iso ? fmtDate(String(iso).slice(0, 10), true) : '')
const RECENT_DAYS = 21

export const reviewsOf = S => (Array.isArray(S?.coachReviews) ? S.coachReviews : []).filter(r => r && r.text)
export const hasUnread = S => reviewsOf(S).some(r => !r.imported && (r.sentAt || '') > (S.reviewsSeenAt || ''))

function markSeen() {
  const S = useStore.getState().S
  const last = reviewsOf(S).reduce((m, r) => (r.sentAt > m ? r.sentAt : m), '')
  if (last && last > (S.reviewsSeenAt || '')) useStore.getState().update(s => { s.reviewsSeenAt = last })
}

function Archive({ close }) {
  const S = useStore(s => s.S)
  const list = [...reviewsOf(S)].reverse()
  return <>
    <h3>Koçunun değerlendirmeleri</h3>
    {!list.length && <div className="empty small">Henüz bir değerlendirme yok.</div>}
    {list.map(r => <div key={r.id} className="card">
      <div className="lbl2">{when(r.sentAt)}</div>
      <div style={{ whiteSpace: 'pre-wrap', marginTop: 6, lineHeight: 1.5 }}>{r.text}</div>
    </div>)}
    <Button variant="ghost" className="dim" onClick={close}>Kapat</Button>
  </>
}
export const reviewsSheet = () => { markSeen(); useUI.getState().openSheet(close => <Archive close={close} />) }

export default function CoachMessageCard() {
  const S = useStore(s => s.S)
  const list = reviewsOf(S)
  // The newest message actually sent from here; ones brought over from the tracker stay in the archive.
  const fresh = list.filter(r => !r.imported)
  const last = fresh[fresh.length - 1]
  if (!last) return null
  const age = (Date.now() - new Date(last.sentAt || 0).getTime()) / 86400000
  if (!(age <= RECENT_DAYS)) return null
  const unread = (last.sentAt || '') > (S.reviewsSeenAt || '')
  return <div className="card" style={unread ? { boxShadow: 'inset 0 0 0 1.5px var(--acc)' } : undefined}>
    <div className="row between" style={{ marginBottom: 8 }}>
      <div className="row" style={{ gap: 9 }}>
        <span className="lrow-i" style={{ background: 'var(--acc)', color: 'var(--on-acc)' }}><Icon name="envelope" /></span>
        <div><div className="lbl2">Koçundan · {when(last.sentAt)}</div><div className="ttl">Haftalık değerlendirme</div></div>
      </div>
      {unread && <span className="tag" style={{ color: 'var(--acc)', borderColor: 'var(--acc)', textTransform: 'none' }}>Yeni</span>}
    </div>
    <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{last.text}</div>
    <div style={{ height: 10 }} />
    <Button size="sm" variant="tinted" onClick={reviewsSheet}>{list.length > 1 ? `Tüm değerlendirmeler (${list.length})` : 'Tamamını oku'}</Button>
  </div>
}
