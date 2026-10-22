import { describe, it, expect } from 'vitest'
import { recentWeight, weighedOn } from './morning-weigh.js'

const S = { bodyweight: [{ d: '2026-10-10', w: 80, t: 1 }, { d: '2026-10-15', w: 79.4, t: 2 }, { d: '2026-10-20', w: 79, t: 3 }] }

describe('morning weigh-in', () => {
  it('stamps the latest weigh-in of the last seven days', () => {
    expect(recentWeight(S, '2026-10-22')).toBe(79)
    expect(recentWeight(S, '2026-10-16')).toBe(79.4)
  })
  it('ignores weigh-ins after the day and older than seven days', () => {
    expect(recentWeight(S, '2026-10-12')).toBe(80)
    expect(recentWeight(S, '2026-10-17')).toBe(79.4)
    expect(recentWeight(S, '2026-10-28')).toBe(null)
    expect(recentWeight(S, '2026-10-26')).toBe(79)
    expect(recentWeight(S, '2026-10-27')).toBe(null)
    expect(recentWeight({ bodyweight: [] }, '2026-10-22')).toBe(null)
  })
  it('knows whether today is in', () => {
    expect(weighedOn(S, '2026-10-20')).toBe(true)
    expect(weighedOn(S, '2026-10-22')).toBe(false)
  })
})
