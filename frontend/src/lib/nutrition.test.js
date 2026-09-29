import { describe, it, expect } from 'vitest'
import { kcalOf, totalsOf, loggedDay, macroTargetFor, dayTypeOf, addToDay, setTotals, setWater, setSleep, setDayType, mergeNutrition } from './nutrition.js'
import { mergeStates } from './sync-merge.js'

const T = { training: { p: 180, c: 250, f: 60 }, rest: { p: 180, c: 150, f: 70 }, water: 3, sleep: 8 }
const base = () => ({ routines: [{ id: 'r', name: 'A', ex: [] }], week: { 1: ['r'] }, dayPlan: {}, workouts: [], nutrition: {}, coachTargets: T })
const MON = '2026-09-28', TUE = '2026-09-29'

describe('totals and targets', () => {
  it('kcal is P*4 + C*4 + F*9', () => {
    expect(kcalOf({ p: 180, c: 250, f: 60 })).toBe(2260)
    expect(kcalOf({})).toBe(0)
  })
  it('reads day totals, and an old per-item day as its sum', () => {
    expect(totalsOf({ p: 150, c: '200,5', f: 60 })).toEqual({ p: 150, c: 200.5, f: 60, kcal: 1942 })
    expect(totalsOf({ items: [{ p: 30, c: '12,5', f: 5 }, { p: 'x', c: 40, f: -3 }] })).toEqual({ p: 30, c: 52.5, f: 5, kcal: 375 })
    expect(totalsOf(null)).toEqual({ p: 0, c: 0, f: 0, kcal: 0 })
    expect(loggedDay({ water: 1 })).toBe(true)
    expect(loggedDay({})).toBe(false)
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
  it('adds meals onto the day, sets the total outright, keeps no items', () => {
    const S = base()
    expect(addToDay(S, MON, { p: 0, c: '', f: 0 })).toBe(false)
    expect(S.nutrition[MON]).toBeUndefined()
    addToDay(S, MON, { p: '40', c: 0, f: '4,2' }, 10)
    addToDay(S, MON, { p: 20, c: 60, f: 10 }, 11)
    expect(S.nutrition[MON]).toEqual({ p: 60, c: 60, f: 14.2, _ts: 11 })
    setTotals(S, MON, { p: 150, c: 220, f: 55 }, 12)
    expect(totalsOf(S.nutrition[MON]).kcal).toBe(1975)
    setWater(S, MON, 2.3); expect(S.nutrition[MON].water).toBe(2.25)
    setWater(S, MON, -1); expect(S.nutrition[MON].water).toBe(0)
    setSleep(S, MON, '7,4'); expect(S.nutrition[MON].sleep).toBe(7.5)
    expect(JSON.stringify(S.nutrition[MON]).length).toBeLessThan(80)   // a day stays a handful of numbers
  })
  it('an old per-item day becomes totals on first edit, nothing lost', () => {
    const S = base()
    S.nutrition[MON] = { items: [{ id: 'a', p: 30, c: 50, f: 10 }, { id: 'b', p: 20, c: 0, f: 5 }], del: ['x'], water: 1, _ts: 1 }
    addToDay(S, MON, { p: 10 }, 5)
    expect(S.nutrition[MON]).toEqual({ p: 60, c: 50, f: 15, water: 1, _ts: 5 })
  })
})

describe('sync', () => {
  it('per day, the copy edited last wins; days only one side has are kept', () => {
    const phone = { [MON]: { p: 100, c: 100, f: 30, water: 1, _ts: 5 } }
    const laptop = { [MON]: { p: 120, c: 150, f: 40, water: 2.5, _ts: 9 }, [TUE]: { p: 5, _ts: 1 } }
    const m = mergeNutrition(phone, laptop)
    expect(m[MON]).toEqual(laptop[MON])
    expect(m[TUE]).toEqual({ p: 5, _ts: 1 })
    expect(mergeNutrition(laptop, phone)[MON]).toEqual(laptop[MON])
    expect(mergeNutrition(null, undefined)).toEqual({})
  })
  it('runs inside openGym\'s own state merge', () => {
    const a = { _ts: 1, workouts: [], routines: [], bodyweight: [], nutrition: { [MON]: { p: 1, _ts: 1 }, [TUE]: { p: 7, _ts: 1 } } }
    const b = { _ts: 2, workouts: [], routines: [], bodyweight: [], nutrition: { [MON]: { p: 2, _ts: 2 } } }
    const out = mergeStates(a, b)
    expect(out.nutrition[MON].p).toBe(2)
    expect(out.nutrition[TUE].p).toBe(7)
  })
})
