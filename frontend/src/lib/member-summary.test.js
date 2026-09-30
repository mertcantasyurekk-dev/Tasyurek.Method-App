// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { buildSummary, statsOf, attentionOf, attentionScore } from './member-summary.js'

const TODAY = '2026-09-30'   // Wednesday
const S = {
  workouts: [{ d: '2026-09-28', entries: [{ id: '0025', sets: [{ done: true }] }] }, { d: '2026-09-29', entries: [{ id: '0025', sets: [{ done: true }] }] }, { d: '2026-08-01', entries: [] }],
  bodyweight: [{ d: '2026-09-25', w: 62 }, { d: '2026-09-29', w: 61.6 }],
  nutrition: { '2026-09-29': { p: 100, c: 150, f: 50 }, '2026-09-28': { p: 110, c: 150, f: 50 }, '2026-09-27': { p: 120, c: 150, f: 50 } },
  cardio: { '2026-09-29': { items: [{ id: 'a', min: 30 }] } },
  measurements: [{ d: '2026-09-15', waistNavel: 70, t: 1 }]
}

describe('summary', () => {
  it('three weeks, day by day, and the last dates; small', () => {
    const s = buildSummary(S, TODAY)
    expect(s.days['2026-09-29']).toEqual({ w: 1, c: 30, k: 1450, p: 100, bw: 61.6 })
    expect(s.days['2026-08-01']).toBeUndefined()                 // outside the window
    expect(s).toMatchObject({ lastWorkout: '2026-09-29', lastWeighIn: '2026-09-29', lastWeight: 61.6, lastLog: '2026-09-29', lastMeasurement: '2026-09-15', lastActive: '2026-09-29' })
    expect(JSON.stringify(s).length).toBeLessThan(1500)
  })
  it('stats for the day the coach looks, not the day it was written', () => {
    const s = buildSummary(S, TODAY)
    expect(statsOf(s, TODAY)).toMatchObject({ workoutsWeek: 2, workouts7: 2, cardioWeek: 30, daysLeftInclToday: 5, logDays7: 3, proteinAvg3: 110, sinceActive: 1, sinceWeighIn: 1, sinceMeasurement: 15 })
    const later = statsOf(s, '2026-10-04')                        // Sunday, nothing new since
    expect(later).toMatchObject({ workoutsWeek: 2, sinceActive: 5, daysLeftInclToday: 1 })
  })
})

describe('attention', () => {
  const T = { workoutsPerWeek: 4, training: { p: 150, c: 200, f: 60 }, rest: { p: 140, c: 150, f: 60 } }
  it('flags what matters, most pressing first', () => {
    const s = buildSummary(S, TODAY)
    const now = attentionOf({ joined: true, planAt: 'x', stats: statsOf(s, TODAY), targets: T })
    expect(now.map(f => f.key)).toEqual(['protein', 'sparse-log', 'measure'])   // 110 < 119; 3/7 days logged; measurement 15 days old
    const sunday = attentionOf({ joined: true, planAt: 'x', stats: statsOf(s, '2026-10-04'), targets: T })
    expect(sunday.map(f => f.key)).toEqual(['inactive', 'week-behind', 'protein', 'weigh-in', 'measure'])
    expect(sunday[0].text).toBe('5 gündür kayıt yok')
    expect(attentionScore(sunday)).toBeGreaterThan(attentionScore(now))
  })
  it('not joined, no plan, no data', () => {
    expect(attentionOf({ joined: false })).toEqual([{ key: 'not-joined', level: 1, text: 'Yeni uygulamayı açmadı' }])
    expect(attentionOf({ joined: true, planAt: null, stats: statsOf(buildSummary({}, TODAY), TODAY), targets: null }).map(f => f.key)).toEqual(['inactive', 'no-plan'])
  })
})
