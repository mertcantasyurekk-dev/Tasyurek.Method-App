import { describe, it, expect } from 'vitest'
import { cleanMembership, daysLeft, levelOf, memberText, coachText, progressOf, extendMonths, fromTracker } from './membership.js'
import { attentionOf } from './member-summary.js'

const T = '2026-10-04'
describe('membership', () => {
  it('days left, levels and texts, as the tracker showed them', () => {
    const at = r => daysLeft({ renewal: r }, T)
    expect([at('2026-10-20'), at('2026-10-11'), at('2026-10-07'), at(T), at('2026-10-02')]).toEqual([16, 7, 3, 0, -2])
    expect([16, 7, 4, 3, 0, -2].map(levelOf)).toEqual(['ok', 'soon', 'soon', 'urgent', 'urgent', 'urgent'])
    expect(memberText(16)).toBe('Üyelik yenilemene 16 gün var')
    expect(memberText(3)).toBe('Üyeliğin 3 gün sonra sona eriyor')
    expect(memberText(0)).toBe('Üyeliğin bugün sona eriyor')
    expect(memberText(-2)).toBe('Üyeliğin 2 gün önce sona erdi')
    expect(coachText(-2)).toBe('Üyelik 2 gün önce bitti')
    expect(daysLeft(null, T)).toBeNull()
  })
  it('progress and extension by months', () => {
    expect(progressOf({ start: '2026-09-04', renewal: '2026-11-04' }, T)).toBeCloseTo(30 / 61, 2)
    expect(extendMonths({ start: '2026-09-04', renewal: '2026-11-04' }, 1, T)).toEqual({ start: '2026-09-04', renewal: '2026-12-04' })   // from the renewal
    expect(extendMonths({ start: '2026-08-01', renewal: '2026-09-01' }, 3, T)).toEqual({ start: T, renewal: '2027-01-04' })          // over: from today
    expect(extendMonths({ renewal: '2027-01-31' }, 1, T).renewal).toBe('2027-02-28')                                                   // no 31 February
    expect(extendMonths(null, 1, T)).toEqual({ start: T, renewal: '2026-11-04' })
  })
  it('cleans what is saved and reads the tracker\'s dates', () => {
    expect(cleanMembership({ start: '2026-12-01', renewal: '2026-11-01' })).toEqual({ start: null, renewal: '2026-11-01' })
    expect(cleanMembership({ start: '2026-10-01' })).toBeNull()
    expect(fromTracker({ customMembership: { startDate: '2026-09-01', renewalDate: '2026-10-01' } })).toEqual({ start: '2026-09-01', renewal: '2026-10-01' })
    expect(fromTracker({})).toBeNull()
  })
  it('an ending membership tops the coach\'s attention list', () => {
    const f = attentionOf({ joined: true, planAt: 'x', stats: null, targets: null, membership: { renewal: '2026-10-06' }, today: T })
    expect(f[0]).toEqual({ key: 'membership', level: 3, text: 'Üyelik 2 gün sonra bitiyor' })
    expect(attentionOf({ joined: false, membership: { renewal: '2026-10-09' }, today: T }).map(x => [x.key, x.level])).toEqual([['membership', 2], ['not-joined', 1]])
    expect(attentionOf({ joined: true, planAt: 'x', stats: null, membership: { renewal: '2026-11-30' }, today: T })).toEqual([])
  })
})
