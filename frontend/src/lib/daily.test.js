// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { addCardio, removeCardio, cardioOf, weekProgress, toggleSupp, takenOn, suppAdherence, mergeCardio, mergeSupps, dailyFromTracker, cardioLabel } from './daily.js'
import { dailyMessage } from './daily-message.js'
import { mergeStates } from './sync-merge.js'

const TUE = '2026-09-29', MON = '2026-09-28'
const plan = () => ({ routines: [{ id: 'r1', name: 'Gün 1', ex: [] }], week: { 1: ['r1'], 2: ['r1'], 4: ['r1'], 5: ['r1'] }, dayPlan: {}, workouts: [], customEx: [],
  coachTargets: { training: { p: 150, c: 200, f: 60 }, rest: { p: 150, c: 150, f: 60 }, water: 3, sleep: 8, workoutsPerWeek: 4, cardioSessionsPerWeek: 3, cardioMinutesPerWeek: 120 } })

describe('cardio and the week', () => {
  it('logs, removes, and counts cardio inside workouts too', () => {
    const S = plan()
    expect(addCardio(S, TUE, { type: 'Walking', min: 0 })).toBeNull()
    const a = addCardio(S, TUE, { type: 'Walking', min: '30' }, 1)
    addCardio(S, MON, { type: 'HIIT', min: 20 }, 2)
    S.workouts = [{ d: MON, entries: [{ id: '0025', sets: [{ w: 60, r: 10, done: true }] }] },
                  { d: TUE, entries: [{ id: 'cx', sets: [{ sec: 900, done: true }] }] }]     // a cardio-only session
    S.customEx = [{ id: 'cx', n: 'Koşu bandı', bp: 'cardio', custom: true }]
    const w = weekProgress(S, TUE)
    expect(w).toMatchObject({ workouts: 1, sessions: 3, minutes: 65, targets: { workouts: 4, sessions: 3, minutes: 120 }, daysLeft: 5 })
    removeCardio(S, TUE, a.id, 3)
    expect(cardioOf(S, TUE)).toEqual([])
    expect(cardioLabel('Incline Walk')).toBe('Eğimli yürüyüş')
  })
  it('syncs cardio item by item and supplements by the last tick', () => {
    const m = mergeCardio({ [TUE]: { items: [{ id: 'a', min: 20, t: 1 }], _ts: 1 } }, { [TUE]: { items: [{ id: 'b', min: 30, t: 2 }], del: ['a'], _ts: 2 } })
    expect(m[TUE].items.map(i => i.id)).toEqual(['b'])
    const s = mergeSupps({ [TUE]: { on: { d3: true }, _ts: 1 } }, { [TUE]: { on: { d3: true, mg: true }, _ts: 2 } })
    expect(s[TUE].on).toEqual({ d3: true, mg: true })
    const out = mergeStates({ _ts: 1, workouts: [], routines: [], bodyweight: [], cardio: { [MON]: { items: [{ id: 'x', min: 10 }], _ts: 1 } } },
                            { _ts: 2, workouts: [], routines: [], bodyweight: [], cardio: { [TUE]: { items: [{ id: 'y', min: 10 }], _ts: 2 } } })
    expect(Object.keys(out.cardio).sort()).toEqual([MON, TUE])
  })
  it('supplement ticks and adherence', () => {
    const S = { coachSupplements: [{ id: 'm', label: 'Sabah', items: [{ id: 'd3', name: 'D3' }, { id: 'om', name: 'Omega 3' }] }] }
    toggleSupp(S, MON, 'd3'); toggleSupp(S, MON, 'om'); toggleSupp(S, '2026-09-27', 'd3')
    expect(takenOn(S, MON)).toEqual({ d3: true, om: true })
    toggleSupp(S, MON, 'om'); expect(takenOn(S, MON)).toEqual({ d3: true })
    expect(suppAdherence(S, TUE, 7)).toBe(17)       // 2 of 12 over six days (today, empty, not counted)
    expect(suppAdherence({}, TUE)).toBeNull()
  })
  it('reads the tracker\'s daily cardio and supplement ticks', () => {
    const r = dailyFromTracker({ daily: { [MON]: { cardio: [{ id: 'c1', type: 'Running', duration: '25' }, { type: 'x', duration: '' }], supplements: { d3: true, om: false } } } })
    expect(r.cardio[MON].items).toEqual([expect.objectContaining({ id: 'tt-' + MON + '-c1', type: 'Running', min: 25 })])
    expect(r.supps[MON].on).toEqual({ d3: true })
  })
})

describe('message of the day', () => {
  it('a welcome with nothing to go on', () => {
    expect(dailyMessage({ workouts: [], nutrition: {} }, TUE, 'Seda Çelik').text).toMatch(/Hoş geldin, Seda/)
  })
  it('done today beats everything; the same all day', () => {
    const S = plan(); S.workouts = [{ d: TUE, entries: [] }]
    const m = dailyMessage(S, TUE)
    expect(m.key).toBe('done-today')
    expect(dailyMessage(S, TUE).text).toBe(m.text)
  })
  it('behind on the week, with the numbers and today\'s routine', () => {
    const S = plan()
    S.workouts = [{ d: MON, entries: [] }]
    const m = dailyMessage(S, '2026-10-02')                 // Friday: 1/4 done, 3 needed, 3 days incl. today
    expect(m.key).toBe('week-behind')
    expect(m.text).toMatch(/3/)
    expect(m.text).toMatch(/Gün 1/)
  })
  it('protein short two days running, with the average', () => {
    const S = plan(); S.week = {}
    S.nutrition = { [MON]: { p: 100, c: 150, f: 50 }, '2026-09-27': { p: 110, c: 150, f: 50 } }
    const m = dailyMessage(S, TUE)
    expect(m.key).toBe('protein-low')
    expect(m.text).toMatch(/105\/150|45 g/)
  })
  it('yesterday on target: praised with the numbers', () => {
    const S = plan(); S.week = {}
    S.nutrition = { [MON]: { p: 152, c: 150, f: 60 } }     // rest-day target 1740 kcal
    const m = dailyMessage(S, TUE)
    expect(m.key).toBe('hit-yesterday')
    expect(m.text).toMatch(/152/)
  })
  it('never talks about the direction of body weight', () => {
    const S = plan(); S.bodyweight = [{ d: MON, w: 80 }, { d: TUE, w: 79 }]
    for (const d of ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-03']) expect(dailyMessage(S, d).text).not.toMatch(/kilo (verdin|aldın)|kilon (düştü|arttı)/i)
  })
})
