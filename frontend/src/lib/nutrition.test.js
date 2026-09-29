import { describe, it, expect } from 'vitest'
import { kcalOf, totalsOf, macroTargetFor, dayTypeOf, addItem, removeItem, setWater, setSleep, setDayType, mergeNutrition } from './nutrition.js'
import { mergeStates } from './sync-merge.js'

const T = { training: { p: 180, c: 250, f: 60 }, rest: { p: 180, c: 150, f: 70 }, water: 3, sleep: 8 }
const base = () => ({ routines: [{ id: 'r', name: 'A', ex: [] }], week: { 1: ['r'] }, dayPlan: {}, workouts: [], nutrition: {}, coachTargets: T })
const MON = '2026-09-28', TUE = '2026-09-29'

describe('totals and targets', () => {
  it('kcal is P*4 + C*4 + F*9', () => {
    expect(kcalOf({ p: 180, c: 250, f: 60 })).toBe(2260)
    expect(kcalOf({})).toBe(0)
  })
  it('sums items, tolerating commas and junk', () => {
    expect(totalsOf({ items: [{ p: 30, c: '12,5', f: 5 }, { p: 'x', c: 40, f: -3 }] })).toEqual({ p: 30, c: 52.5, f: 5, kcal: 375 })
    expect(totalsOf(null)).toEqual({ p: 0, c: 0, f: 0, kcal: 0 })
  })
  it('picks the training set on a planned day, rest otherwise; the member can flip it', () => {
    const S = base()
    expect(dayTypeOf(S, MON)).toBe('training')
    expect(macroTargetFor(S, MON)).toMatchObject({ p: 180, c: 250, f: 60, kcal: 2260, type: 'training' })
    expect(macroTargetFor(S, TUE)).toMatchObject({ c: 150, type: 'rest' })
    setDayType(S, TUE, 'training')
    expect(macroTargetFor(S, TUE).type).toBe('training')
    setDayType(S, TUE, null)
    expect(macroTargetFor(S, TUE).type).toBe('rest')
    S.workouts = [{ d: TUE }]
    expect(dayTypeOf(S, TUE)).toBe('training')   // trained on a rest day
  })
  it('one set only: that set, no day type; no targets: null', () => {
    const S = base(); S.coachTargets = { training: { p: 150, c: 200, f: 50 }, rest: {} }
    expect(macroTargetFor(S, TUE)).toMatchObject({ p: 150, type: null })
    S.coachTargets = null
    expect(macroTargetFor(S, TUE)).toBeNull()
    S.myTargets = T
    expect(macroTargetFor(S, MON).p).toBe(180)
  })
})

describe('edits', () => {
  it('adds, removes, and clamps water and sleep', () => {
    const S = base()
    expect(addItem(S, MON, { p: 0, c: '', f: 0 })).toBeNull()
    const a = addItem(S, MON, { name: ' Tavuk ', p: '40', c: 0, f: '4,2' }, 10)
    addItem(S, MON, { p: 20, c: 60, f: 10 }, 11)
    expect(a).toMatchObject({ name: 'Tavuk', p: 40, f: 4.2 })
    expect(totalsOf(S.nutrition[MON])).toMatchObject({ p: 60, c: 60, f: 14.2 })
    removeItem(S, MON, a.id, 12)
    expect(S.nutrition[MON].items).toHaveLength(1)
    expect(S.nutrition[MON].del).toEqual([a.id])
    setWater(S, MON, 2.3); expect(S.nutrition[MON].water).toBe(2.25)
    setWater(S, MON, -1); expect(S.nutrition[MON].water).toBe(0)
    setSleep(S, MON, '7,4'); expect(S.nutrition[MON].sleep).toBe(7.5)
  })
})

describe('sync', () => {
  it('keeps what both phones added, drops what either deleted, newer day wins for water', () => {
    const phone = { [MON]: { items: [{ id: 'a', p: 10, t: 1 }, { id: 'b', p: 20, t: 2 }], water: 1, _ts: 5 } }
    const laptop = { [MON]: { items: [{ id: 'a', p: 10, t: 1 }, { id: 'c', p: 30, t: 3 }], del: ['b'], water: 2.5, _ts: 9 }, [TUE]: { items: [{ id: 'd', p: 5 }], _ts: 1 } }
    const m = mergeNutrition(phone, laptop)
    expect(m[MON].items.map(i => i.id)).toEqual(['a', 'c'])
    expect(m[MON].water).toBe(2.5)
    expect(m[MON].del).toEqual(['b'])
    expect(m[MON]._ts).toBe(9)
    expect(m[TUE].items).toHaveLength(1)
    expect(mergeNutrition(null, undefined)).toEqual({})
  })
  it('runs inside openGym\'s own state merge', () => {
    const a = { _ts: 1, workouts: [], routines: [], bodyweight: [], nutrition: { [MON]: { items: [{ id: 'x', p: 1 }], _ts: 1 } } }
    const b = { _ts: 2, workouts: [], routines: [], bodyweight: [], nutrition: { [MON]: { items: [{ id: 'y', p: 2 }], _ts: 2 } } }
    const out = mergeStates(a, b)
    expect(out.nutrition[MON].items.map(i => i.id).sort()).toEqual(['x', 'y'])
  })
})
