// Taşyürek Method: a member's membership — when it started and when it is due for renewal, set by
// the coach (coachplan/{uid}.membership = { start, renewal }, 'YYYY-MM-DD'), seen by the member.
// The tracker kept the same two dates in payload.customMembership { startDate, renewalDate }; the
// colours follow it: more than 7 days green, 7 or fewer orange, 3 or fewer (and past) red.

const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const todayLocal = () => iso(new Date())

export function cleanMembership(m) {
  if (!m) return null
  const start = isDate(m.start) ? m.start : null
  const renewal = isDate(m.renewal) ? m.renewal : null
  if (!renewal) return null
  return { start: start && start <= renewal ? start : null, renewal }
}

export function daysLeft(m, today = todayLocal()) {
  if (!m?.renewal) return null
  return Math.round((new Date(m.renewal + 'T12:00:00') - new Date(today + 'T12:00:00')) / 86400000)
}

// 'ok' | 'soon' (≤7) | 'urgent' (≤3, today, or over)
export const levelOf = n => (n === null ? null : n <= 3 ? 'urgent' : n <= 7 ? 'soon' : 'ok')
export const colorOf = l => (l === 'urgent' ? 'var(--red)' : l === 'soon' ? 'var(--orange)' : 'var(--green)')

export function memberText(n) {
  if (n === null) return ''
  if (n < 0) return `Üyeliğin ${-n} gün önce sona erdi`
  if (n === 0) return 'Üyeliğin bugün sona eriyor'
  if (n <= 7) return `Üyeliğin ${n} gün sonra sona eriyor`
  return `Üyelik yenilemene ${n} gün var`
}
export function coachText(n) {
  if (n === null) return 'Üyelik tarihi yok'
  if (n < 0) return `Üyelik ${-n} gün önce bitti`
  if (n === 0) return 'Üyelik bugün bitiyor'
  return `Üyelik ${n} gün sonra bitiyor`
}

// Share of the membership used, 0…1 (null without a start).
export function progressOf(m, today = todayLocal()) {
  if (!m?.start || !m?.renewal) return null
  const a = new Date(m.start + 'T12:00:00'), b = new Date(m.renewal + 'T12:00:00'), t = new Date(today + 'T12:00:00')
  if (b <= a) return null
  return Math.max(0, Math.min(1, (t - a) / (b - a)))
}

// Extend by whole months: from the renewal date, or from today when it has already passed.
export function extendMonths(m, months, today = todayLocal()) {
  const from = m?.renewal && m.renewal >= today ? m.renewal : today
  const d = new Date(from + 'T12:00:00')
  const day = d.getDate()
  d.setDate(1); d.setMonth(d.getMonth() + months)
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
  return { start: m?.renewal && m.renewal >= today ? (m.start || today) : today, renewal: iso(d) }
}

export const fromTracker = payload => {
  const c = payload?.customMembership
  return c ? cleanMembership({ start: c.startDate, renewal: c.renewalDate }) : null
}
