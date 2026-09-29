import { describe, it, expect } from 'vitest'
import { kcalOf, totalsOf, loggedDay, macroTargetFor, dayTypeOf, addFood, addToDay, removeItem, setTotals, setWater, setSleep, setDayType, mealsOf, isClosedDay, mergeNutrition, compactNutrition, sealDay, weekStartIso } from './nutrition.js'
import { mergeStates } from './sync-merge.js'

const T = { training: { p: 180, c: 250, f: 60 }, rest: { p: 180, c: 150, f: 70 }, water: 3, sleep: 8 }
const base = () => ({ routines: [{ id: 'r', name: 'A', ex: [] }], week: { 1: ['r'] }, dayPlan: {}, workouts: [], nutrition: {}, coachTargets: T })
const MON = '2026-09-28', TUE = '2026-09-29', LAST_FRI = '2026-09-25', LAST_SUN = '2026-09-27'

describe('totals and targets', () => {
  it('kcal is P*4 + C*4 + F*9', () => {
    expect(kcalOf({ p: 180, c: 250, f: 60 })).toBe(2260)
  })
  it('totals = base + items; corrections may be negative; never below zero', () => {
    expect(totalsOf({ p: 100, c: 100, f: 20, items: [{ p: 30, c: 0, f: 5 }, { x: 1, p: -10, c: -20, f: 0 }] })).toEqual({ p: 120, c: 80, f: 25, kcal: 1025 })
    expect(totalsOf({ items: [{ x: 1, p: -50 }] }).p).toBe(0)
    expect(totalsOf(null).kcal).toBe(0)
    expect(loggedDay({ water: 1 })).toBe(true)
  })
  it('picks the training set on a planned day, rest otherwise; the member can flip it', () => {
    const S = base()
    expect(macroTargetFor(S, MON)).toMatchObject({ kcal: 2260, type: 'training' })
    expect(macroTargetFor(S, TUE).type).toBe('rest')
    setDayType(S, TUE, 'training'); expect(dayTypeOf(S, TUE)).toBe('training')
    setDayType(S, TUE, null); S.workouts = [{ d: TUE }]; expect(dayTypeOf(S, TUE)).toBe('training')
  })
})

describe('this week: meals', () => {
  it('adds foods to meals, quick grams, removes, corrects the total', () => {
    const S = base()
    const egg = addFood(S, TUE, { meal: 'b', fid: 'egg', name: 'Yumurta', qty: 2, unit: '1 adet', p: 13, c: 1.2, f: 10.6 }, 10)
    addFood(S, TUE, { meal: 'l', name: 'Pilav', qty: 150, unit: 'g', p: 4, c: 42, f: 5 }, 11)
    expect(addFood(S, TUE, { meal: 'l', name: 'Su', p: 0, c: 0, f: 0 })).toBeNull()
    addToDay(S, TUE, { p: 30, meal: 's' }, 12)
    expect(totalsOf(S.nutrition[TUE])).toMatchObject({ p: 47, c: 43.2, f: 15.6 })
    expect(mealsOf(S.nutrition[TUE]).map(g => [g.key, g.items.length])).toEqual([['b', 1], ['l', 1], ['s', 1]])
    removeItem(S, TUE, egg.id, 13)
    expect(totalsOf(S.nutrition[TUE]).p).toBe(34)
    expect(S.nutrition[TUE].del).toEqual([egg.id])
    setTotals(S, TUE, { p: 40, c: 43.2, f: 5 }, 14)
    expect(totalsOf(S.nutrition[TUE])).toMatchObject({ p: 40, c: 43.2, f: 5 })   // exactly what was asked
    expect(mealsOf(S.nutrition[TUE]).at(-1).key).toBe('x')
    setWater(S, TUE, 2.3); expect(S.nutrition[TUE].water).toBe(2.25)
    setSleep(S, TUE, '7,4'); expect(S.nutrition[TUE].sleep).toBe(7.5)
  })
})

describe('the weekly seal', () => {
  it('the week starts on Monday (or Sunday)', () => {
    expect(weekStartIso(TUE)).toBe(MON)
    expect(weekStartIso(LAST_SUN)).toBe('2026-09-21')
    expect(weekStartIso(TUE, 0)).toBe(LAST_SUN)
    expect(isClosedDay({}, LAST_FRI, TUE)).toBe(true)
    expect(isClosedDay({}, MON, TUE)).toBe(false)
  })
  it('folds last week\'s meals into totals and keeps nothing of what was eaten', () => {
    const S = base()
    addFood(S, LAST_FRI, { meal: 'b', name: 'Yumurta', p: 13, c: 1, f: 10 }, 1)
    addFood(S, LAST_FRI, { meal: 'd', name: 'Köfte', p: 30, c: 5, f: 20 }, 2)
    setWater(S, LAST_FRI, 2.5, 3)
    addFood(S, MON, { meal: 'b', name: 'Yulaf', p: 10, c: 60, f: 6 }, 4)
    expect(compactNutrition(S, TUE, 100)).toBe(1)
    expect(S.nutrition[LAST_FRI]).toEqual({ p: 43, c: 6, f: 30, water: 2.5, sealedAt: 100, _ts: 100 })
    expect(JSON.stringify(S.nutrition[LAST_FRI])).not.toMatch(/Yumurta|Köfte/)
    expect(S.nutrition[MON].items).toHaveLength(1)            // this week keeps its meals
    expect(compactNutrition(S, TUE, 200)).toBe(0)             // nothing left to seal
  })
  it('the stored copy of a year is a few numbers a day', () => {
    const S = base()
    for (let i = 0; i < 365; i++) {
      const d = new Date('2025-09-01T12:00:00'); d.setDate(d.getDate() + i)
      const iso = d.toISOString().slice(0, 10)
      for (let k = 0; k < 8; k++) addFood(S, iso, { meal: 'l', name: 'Bir yemek adı biraz uzun', qty: 150, unit: 'g', p: 20, c: 30, f: 10 }, i * 10 + k)
      setWater(S, iso, 2.5, i * 10 + 9)
    }
    compactNutrition(S, '2026-09-29')
    const bytes = JSON.stringify(S.nutrition).length
    expect(bytes).toBeLessThan(365 * 110)
  })
})

describe('sync', () => {
  it('this week: items from both phones, minus deletions; water from the newer copy', () => {
    const phone = { [TUE]: { items: [{ id: 'a', p: 10, t: 1 }, { id: 'b', p: 20, t: 2 }], water: 1, _ts: 5 } }
    const laptop = { [TUE]: { items: [{ id: 'a', p: 10, t: 1 }, { id: 'c', p: 30, t: 3 }], del: ['b'], water: 2.5, _ts: 9 } }
    const m = mergeNutrition(phone, laptop)
    expect(m[TUE].items.map(i => i.id)).toEqual(['a', 'c'])
    expect(m[TUE].water).toBe(2.5)
    expect(totalsOf(m[TUE]).p).toBe(40)
  })
  it('a sealed day is never counted twice against a copy that still has its meals', () => {
    const unsealed = { [LAST_FRI]: { items: [{ id: 'a', p: 10, t: 1 }, { id: 'b', p: 20, t: 2 }], _ts: 2 } }
    const sealed = { [LAST_FRI]: sealDay(JSON.parse(JSON.stringify(unsealed[LAST_FRI])), 50) }
    for (const m of [mergeNutrition(unsealed, sealed), mergeNutrition(sealed, unsealed)]) {
      expect(totalsOf(m[LAST_FRI]).p).toBe(30)
      expect(m[LAST_FRI].items).toBeUndefined()
      expect(m[LAST_FRI].sealedAt).toBe(50)
    }
  })
  it('a meal added to a sealed day after the seal is kept', () => {
    const sealed = { [LAST_FRI]: { p: 30, c: 0, f: 0, sealedAt: 50, _ts: 50 } }
    const late = { [LAST_FRI]: { p: 30, c: 0, f: 0, sealedAt: 50, items: [{ id: 'z', p: 5, t: 60 }], _ts: 60 } }
    const m = mergeNutrition(sealed, late)
    expect(totalsOf(m[LAST_FRI]).p).toBe(35)
  })
  it('runs inside openGym\'s own state merge', () => {
    const a = { _ts: 1, workouts: [], routines: [], bodyweight: [], nutrition: { [TUE]: { items: [{ id: 'x', p: 1, t: 1 }], _ts: 1 } } }
    const b = { _ts: 2, workouts: [], routines: [], bodyweight: [], nutrition: { [TUE]: { items: [{ id: 'y', p: 2, t: 2 }], _ts: 2 } } }
    expect(mergeStates(a, b).nutrition[TUE].items.map(i => i.id).sort()).toEqual(['x', 'y'])
  })
})
