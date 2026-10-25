import { describe, it, expect } from 'vitest'
import { missingFrom, countOf, totalOf, pick, applyRestore, combine, coachPartsIn, emptyRestore } from './restore.js'

const backup = {
  unit: 'kg',
  workouts: [{ id: 'w1', d: '2026-10-01', start: 1, entries: [] }, { id: 'w2', d: '2026-10-03', start: 3, entries: [] }],
  bodyweight: [{ d: '2026-10-01', w: 80, t: 1 }, { d: '2026-10-02', w: 79.5, t: 2 }],
  nutrition: { '2026-10-01': { p: 150, c: 200, f: 60 }, '2026-10-02': { p: 140, c: 180, f: 55 } },
  measurements: [{ d: '2026-10-01', chest: 100, t: 1 }, { d: '2026-10-02', chest: 101, t: 2 }],
  cardio: { '2026-10-01': { items: [{ id: 'c1', type: 'Walking', min: 30, t: 1 }, { id: 'c2', type: 'HIIT', min: 15, t: 2 }] } },
  supps: { '2026-10-01': { on: { a: true } } },
  dayNotes: { '2026-10-01': { text: 'yorgun', t: 1 } },
}
const current = () => ({
  unit: 'kg',
  workouts: [{ id: 'w1', d: '2026-10-01', start: 1, entries: [], note: 'edited' }],
  bodyweight: [{ d: '2026-10-01', w: 81, t: 9 }],
  nutrition: { '2026-10-01': { p: 1, c: 1, f: 1 } },
  measurements: [{ d: '2026-10-02', del: true, t: 9 }],
  cardio: { '2026-10-01': { items: [{ id: 'c1', type: 'Walking', min: 30, t: 1 }], del: ['c2'] } },
  supps: {}, dayNotes: {},
})

describe('restore from a backup', () => {
  it('finds only what the profile lacks, and keeps deliberate deletions deleted', () => {
    const m = missingFrom(backup, current())
    expect(m.workouts.map(w => w.id)).toEqual(['w2'])
    expect(m.bodyweight.map(b => b.d)).toEqual(['2026-10-02'])
    expect(Object.keys(m.nutrition)).toEqual(['2026-10-02'])
    expect(m.measurements.map(x => x.d)).toEqual(['2026-10-01'])   // 10-02 was deleted on purpose
    expect(m.cardio).toEqual({})                                     // c1 is there, c2 was deleted
    expect(Object.keys(m.supps)).toEqual(['2026-10-01'])
    expect(Object.keys(m.dayNotes)).toEqual(['2026-10-01'])
    expect(countOf(m)).toEqual({ workouts: 1, bodyweight: 1, nutrition: 1, measurements: 1, cardio: 0, supps: 1, dayNotes: 1 })
  })
  it('never overwrites: an existing record stays as it is', () => {
    const s = current()
    applyRestore(s, missingFrom(backup, current()), 100)
    expect(s.workouts.find(w => w.id === 'w1').note).toBe('edited')
    expect(s.bodyweight.find(b => b.d === '2026-10-01').w).toBe(81)
    expect(s.nutrition['2026-10-01'].p).toBe(1)
  })
  it('adds, keeps order, and adds nothing the second time', () => {
    const s = current()
    const r = missingFrom(backup, current())
    expect(applyRestore(s, r, 100)).toBe(totalOf(r))
    expect(s.workouts.map(w => w.id)).toEqual(['w1', 'w2'])
    expect(s.bodyweight.map(b => b.d)).toEqual(['2026-10-01', '2026-10-02'])
    expect(s.nutrition['2026-10-02']._ts).toBe(100)
    expect(applyRestore(s, r, 200)).toBe(0)
    expect(s.workouts).toHaveLength(2)
  })
  it('only the chosen kinds', () => {
    const r = pick(missingFrom(backup, current()), ['workouts'])
    expect(totalOf(r)).toBe(1)
    const s = current(); applyRestore(s, r)
    expect(s.bodyweight).toHaveLength(1)
  })
  it('cardio items come back into an existing day', () => {
    const s = { cardio: { '2026-10-01': { items: [{ id: 'x', min: 10, t: 0 }] } } }
    const r = missingFrom(backup, s)
    expect(r.cardio['2026-10-01'].items.map(i => i.id)).toEqual(['c1', 'c2'])
    applyRestore(s, r, 5)
    expect(s.cardio['2026-10-01'].items.map(i => i.id)).toEqual(['x', 'c1', 'c2'])
  })
  it('a request waiting twice is joined and gives each record once', () => {
    const r = missingFrom(backup, current())
    const both = combine(r, r)
    expect(both.workouts).toHaveLength(2)
    const s = current()
    expect(applyRestore(s, both)).toBe(totalOf(r))
    expect(s.workouts.filter(w => w.id === 'w2')).toHaveLength(1)
  })
  it('converts units to the profile’s', () => {
    const lb = { unit: 'lb', bodyweight: [] }
    const r = missingFrom({ unit: 'kg', bodyweight: [{ d: '2026-10-05', w: 100, t: 1 }] }, lb)
    expect(r.bodyweight[0].w).toBeGreaterThan(200)
  })
  it('an empty backup or empty request adds nothing', () => {
    expect(totalOf(missingFrom(null, current()))).toBe(0)
    const s = current(); expect(applyRestore(s, emptyRestore())).toBe(0)
  })
  it('lists the coach parts a backup holds', () => {
    const plan = { plan: { stringValue: '{"routines":[]}' }, targets: { nullValue: null }, reviews: { stringValue: '[]' }, membership: { stringValue: '{"renewal":"2026-11-01"}' } }
    const notes = { note: { stringValue: 'diz' } }
    expect(coachPartsIn(plan, notes).map(p => p.key)).toEqual(['plan', 'membership', 'notes'])
    expect(coachPartsIn(null, null)).toEqual([])
  })
})
