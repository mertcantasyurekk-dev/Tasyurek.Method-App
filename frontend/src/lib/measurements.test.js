import { describe, it, expect } from 'vitest'
import { entriesOf, latestOf, changesOf, isDue, daysSinceLast, saveMeasurement, removeMeasurement, mergeMeasurements, measureLine, lastInPeriod, fromTracker, seriesOf } from './measurements.js'
import { mergeStates } from './sync-merge.js'

const S0 = () => ({ measurements: [] })

describe('entering', () => {
  it('keeps sane cm values only, one entry per day, partial days allowed', () => {
    const S = S0()
    expect(saveMeasurement(S, '2026-09-07', { waistNavel: '5', chest: 'x' })).toBe(false)
    expect(saveMeasurement(S, '2026-09-07', { waistNavel: '84,5', armL: 35, chest: 300 }, 1)).toBe(true)
    expect(S.measurements).toEqual([{ d: '2026-09-07', waistNavel: 84.5, armL: 35, t: 1 }])
    saveMeasurement(S, '2026-09-07', { waistNavel: 84 }, 2)                 // same day again: replaces
    expect(S.measurements).toEqual([{ d: '2026-09-07', waistNavel: 84, t: 2 }])
  })
  it('a removal hides the day and stays as a marker', () => {
    const S = S0()
    saveMeasurement(S, '2026-09-07', { hips: 98 }, 1)
    removeMeasurement(S, '2026-09-07', 2)
    expect(entriesOf(S)).toEqual([])
    expect(S.measurements).toEqual([{ d: '2026-09-07', del: true, t: 2 }])
  })
})

describe('changes', () => {
  const S = { measurements: [
    { d: '2026-09-07', waistNavel: 86, armL: 34, t: 1 },
    { d: '2026-09-14', waistNavel: 85.2, armL: 34.5, t: 2 },
    { d: '2026-09-21', waistNavel: 84.6, t: 3 },          // arm not measured this week
    { d: '2026-09-20', del: true, t: 9 }
  ] }
  it('each field against its own previous and first measurement', () => {
    const c = changesOf(S)
    expect(c.waistNavel).toMatchObject({ v: 84.6, d: '2026-09-21', dPrev: -0.6, dFirst: -1.4 })
    expect(c.armL).toMatchObject({ v: 34.5, d: '2026-09-14', dPrev: 0.5, dFirst: 0.5 })
    expect(c.chest).toBeUndefined()
    expect(latestOf(S).d).toBe('2026-09-21')
    expect(seriesOf(S, 'waistNavel').map(p => p.y)).toEqual([86, 85.2, 84.6])
  })
  it('asks again after a week', () => {
    expect(daysSinceLast(S, '2026-09-27')).toBe(6)
    expect(isDue(S, '2026-09-27')).toBe(false)
    expect(isDue(S, '2026-09-28')).toBe(true)
    expect(isDue(S0(), '2026-09-28')).toBe(true)
  })
})

describe('sync', () => {
  it('per day the newest version wins; a removal wins over an older entry', () => {
    const phone = [{ d: '2026-09-14', waistNavel: 85, t: 5 }, { d: '2026-09-21', hips: 97, t: 6 }]
    const laptop = [{ d: '2026-09-14', del: true, t: 8 }, { d: '2026-09-07', hips: 99, t: 1 }]
    const m = mergeMeasurements(phone, laptop)
    expect(m.map(x => [x.d, !!x.del])).toEqual([['2026-09-07', false], ['2026-09-14', true], ['2026-09-21', false]])
    expect(entriesOf({ measurements: m }).map(x => x.d)).toEqual(['2026-09-07', '2026-09-21'])
  })
  it('runs inside openGym\'s own state merge', () => {
    const a = { _ts: 1, workouts: [], routines: [], bodyweight: [], measurements: [{ d: '2026-09-07', hips: 99, t: 1 }] }
    const b = { _ts: 2, workouts: [], routines: [], bodyweight: [], measurements: [{ d: '2026-09-14', hips: 98, t: 2 }] }
    expect(mergeStates(a, b).measurements.map(x => x.d)).toEqual(['2026-09-07', '2026-09-14'])
  })
})

describe('360° and the tracker', () => {
  it('writes the tracker\'s line', () => {
    expect(measureLine({ shoulder: 118, waistNavel: 84.55, legR: 58 })).toBe('omuz 118 | bel-göbek 84.6 | sağ bacak 58')
    expect(measureLine(null)).toBe('—')
    const S = { measurements: [{ d: '2026-09-15', hips: 99, t: 1 }, { d: '2026-09-18', hips: 98, t: 2 }, { d: '2026-09-22', hips: 97, t: 3 }] }
    expect(lastInPeriod(S, ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']).hips).toBe(98)
    expect(lastInPeriod(S, ['2026-09-01'])).toBeNull()
  })
  it('reads the tracker\'s entries', () => {
    expect(fromTracker([{ id: 'a', date: '2026-09-07', waistNavel: '84', armL: 35, weight: 80 }, { id: 'b', date: 'x', hips: 90 }, { date: '2026-09-08', note: 'y' }]))
      .toEqual([{ d: '2026-09-07', waistNavel: 84, armL: 35 }])
  })
})
