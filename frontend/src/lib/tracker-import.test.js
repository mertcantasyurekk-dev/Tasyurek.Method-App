// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { parseReps, readPayload, convertTracker, applyTrackerImport, trackerPlan, defaultWeek } from './tracker-import.js'
import { DEF } from '../store/useStore.js'
import { EXIDX } from './exercises.js'

const clone = o => JSON.parse(JSON.stringify(o))

// Shaped exactly like userdata/{uid}.payload (TASYUREK-TRACKER-PROJE-BILGISI.md §4).
const PAYLOAD = {
  targets: { protein: 180, carbs: 250, fat: 60, water: 3, sleep: 8 },
  activeProgramId: 'p2',
  programs: [
    { id: 'p1', name: 'Eski program', days: [{ id: 'x', label: 'X', exercises: [{ name: 'barbell bench press', sets: 3, reps: '5' }] }] },
    { id: 'p2', name: 'Başlangıç - Tam Vücut', days: [
      { id: 'd1', label: 'Gün 1', focus: 'Tam vücut A', exercises: [
        { name: 'barbell bench press', sets: 4, reps: '8-10', rir: '2', warmupSets: 2, note: '+2.5 kg tümü 10 olunca' },
        { name: 'Incline DB Press (30°)', sets: 3, reps: '10', rir: '' },
        { name: '', sets: 3, reps: '10' }
      ] },
      { id: 'd2', label: 'Gün 2', exercises: [{ name: 'lever lying leg curl', sets: '3', reps: '12-15' }] },
      { id: 'd3', label: 'Boş gün', exercises: [] }
    ] }
  ],
  workouts: [
    { date: '2026-09-01', label: 'Gün 1', exercises: [
      { id: 'a', name: 'Barbell Bench Press', sets: [{ weight: '60', reps: '10' }, { weight: '62,5', reps: '8' }, { weight: '', reps: '' }] },
      { id: 'b', name: 'Incline DB Press (30°)', sets: [{ weight: '22', reps: '10' }] }
    ] },
    { date: '2026-09-03', label: 'Gün 2', exercises: [{ id: 'c', name: 'lever lying leg curl', sets: [{ weight: '40', reps: '12' }] }] },
    { date: '2026-09-03', label: 'Kardiyo notu', exercises: [{ id: 'd', name: 'Landmine Press', sets: [{ weight: '0', reps: '20' }] }] },
    { date: 'bozuk', label: 'x', exercises: [{ name: 'barbell bench press', sets: [{ weight: '1', reps: '1' }] }] },
    { date: '2026-09-05', label: 'Boş', exercises: [{ name: 'barbell bench press', sets: [{ weight: '', reps: '' }] }] }
  ],
  daily: {
    '2026-09-01': { weight: '84,2', protein: 150 },
    '2026-09-02': { weight: 83.9 },
    '2026-09-03': { protein: 120 },
    '2026-09-04': { weight: '5' }
  }
}

describe('parseReps', () => {
  it('reads ranges, single numbers and anything else', () => {
    expect(parseReps('8-10')).toEqual({ reps: 10, repsMin: 8 })
    expect(parseReps('12 – 15')).toEqual({ reps: 15, repsMin: 12 })
    expect(parseReps('10-8')).toEqual({ reps: 10, repsMin: 8 })
    expect(parseReps('6')).toEqual({ reps: 6 })
    expect(parseReps('5-5')).toEqual({ reps: 5 })
    expect(parseReps('AMRAP')).toEqual({ reps: 10 })
    expect(parseReps(undefined)).toEqual({ reps: 10 })
  })
})

describe('readPayload', () => {
  it('takes the stored string, an object, or nothing', () => {
    expect(readPayload(JSON.stringify({ a: 1 }))).toEqual({ a: 1 })
    expect(readPayload({ a: 1 })).toEqual({ a: 1 })
    expect(readPayload('{bozuk')).toBeNull()
    expect(readPayload(null)).toBeNull()
  })
})

describe('convertTracker', () => {
  const conv = convertTracker(PAYLOAD)

  it('turns the active program (only) into routines', () => {
    expect(conv.programName).toBe('Başlangıç - Tam Vücut')
    expect(conv.routines.map(r => r.name)).toEqual(['Gün 1 — Tam vücut A', 'Gün 2'])   // the empty day is dropped
    const [bench, incline] = conv.routines[0].ex
    expect(EXIDX[bench.id].n).toBe('barbell bench press')
    expect(bench).toMatchObject({ sets: 4, reps: 10, repsMin: 8, prog: 'double', warmupSets: 2, note: 'RIR 2 · +2.5 kg tümü 10 olunca', weight: 0 })
    expect(incline).toMatchObject({ sets: 3, reps: 10 })
    expect(incline.prog).toBeUndefined()
    expect(incline.note).toBeUndefined()
    expect(conv.routines[0].ex).toHaveLength(2)   // the nameless exercise is dropped
    expect(conv.routines[1].ex[0]).toMatchObject({ sets: 3, reps: 15, repsMin: 12, prog: 'double' })
  })

  it('links library names only, and keeps the coach\'s wording for the rest', () => {
    expect(conv.customEx.map(c => c.n).sort()).toEqual(['Incline DB Press (30°)', 'Landmine Press'].sort())
    const inc = conv.customEx.find(c => c.n.startsWith('Incline'))
    expect(inc).toMatchObject({ custom: true, eq: 'custom' })
    // the same custom is used by the routine and by the logged workout
    expect(conv.routines[0].ex[1].id).toBe(inc.id)
    expect(conv.workouts[0].entries[1].id).toBe(inc.id)
  })

  it('converts workouts: numbers with commas, empty sets and broken dates dropped', () => {
    expect(conv.workouts.map(w => [w.d, w.name])).toEqual([
      ['2026-09-01', 'Gün 1'], ['2026-09-03', 'Gün 2'], ['2026-09-03', 'Kardiyo notu']
    ])
    const bench = conv.workouts[0].entries[0]
    expect(bench.sets).toEqual([{ w: 60, r: 10, done: true }, { w: 62.5, r: 8, done: true }])
    expect(bench.topW).toBe(62.5)
    expect(conv.workouts[0].vol).toBe(60 * 10 + 62.5 * 8 + 22 * 10)
    expect(conv.workouts[2].entries[0]).toMatchObject({ sets: [{ w: 0, r: 20, done: true }], topW: null })
  })

  it('keeps plausible daily weights only', () => {
    expect(conv.bodyweight.map(b => [b.d, b.w])).toEqual([['2026-09-01', 84.2], ['2026-09-02', 83.9]])
  })

  it('reuses a custom exercise the profile already has', () => {
    const mine = { id: 'mine1', n: 'incline db press (30°)', custom: true }
    const c2 = convertTracker(PAYLOAD, [mine])
    expect(c2.customEx.map(c => c.n)).toEqual(['Landmine Press'])
    expect(c2.routines[0].ex[1].id).toBe('mine1')
  })

  it('copes with an empty or odd payload', () => {
    expect(convertTracker({})).toMatchObject({ routines: [], workouts: [], bodyweight: [], customEx: [] })
    expect(convertTracker({ programs: 'x', workouts: null, daily: [] })).toMatchObject({ routines: [], workouts: [] })
  })
})

describe('applyTrackerImport', () => {
  it('first import brings everything; a second one only what is new, never duplicates', () => {
    const S = clone(DEF)
    S.workouts = [{ id: 'own', d: '2026-09-03', entries: [], prs: [] }]   // trained in the new app that day
    const r1 = applyTrackerImport(S, convertTracker(PAYLOAD, S.customEx), { now: 'T1' })
    expect(r1).toMatchObject({ routines: 2, workouts: 1, workoutsSkipped: 2, weights: 2, customs: 2 })
    expect(S.workouts.map(w => w.d)).toEqual(['2026-09-01', '2026-09-03'])
    expect(S.workouts.find(w => w.d === '2026-09-03').id).toBe('own')
    expect(S.routines).toHaveLength(2)
    expect(S.customEx).toHaveLength(2)
    expect(S.bodyweight.map(b => b.w)).toEqual([84.2, 83.9])
    expect(S.trackerImport).toEqual({ at: 'T1' })
    const benchId = S.routines[0].ex[0].id
    expect(S.exWeights[benchId]).toEqual({ w: 62.5, d: '2026-09-01' })

    // A week later the tracker has one more workout and weigh-in.
    const later = clone(PAYLOAD)
    later.workouts.push({ date: '2026-09-08', label: 'Gün 1', exercises: [{ name: 'Incline DB Press (30°)', sets: [{ weight: '24', reps: '9' }] }] })
    later.daily['2026-09-08'] = { weight: '83,5' }
    const r2 = applyTrackerImport(S, convertTracker(later, S.customEx), { now: 'T2' })
    expect(r2).toMatchObject({ routines: 0, workouts: 1, weights: 1, customs: 0 })
    expect(S.routines).toHaveLength(2)
    expect(S.customEx).toHaveLength(2)
    expect(S.workouts.map(w => w.d)).toEqual(['2026-09-01', '2026-09-03', '2026-09-08'])
    expect(S.trackerImport).toEqual({ at: 'T2', firstAt: 'T1' })

    const r3 = applyTrackerImport(S, convertTracker(later, S.customEx), { now: 'T3' })
    expect(r3).toMatchObject({ routines: 0, workouts: 0, weights: 0, customs: 0 })
    expect(S.trackerImport).toEqual({ at: 'T3', firstAt: 'T1' })
  })
})

describe('with a coach plan', () => {
  it('brings history and weights, not the tracker routines', () => {
    const S = clone(DEF)
    S.coachPlanAt = '2026-09-28T10:00:00Z'
    S.routines = [{ id: 'cA', name: 'Koç A', ex: [] }]
    const r = applyTrackerImport(S, convertTracker(PAYLOAD, S.customEx), { now: 'T1' })
    expect(r.routines).toBe(0)
    expect(S.routines.map(x => x.id)).toEqual(['cA'])
    expect(r.workouts).toBe(3)
    expect(r.weights).toBe(2)
  })
})

describe('nutrition from the tracker', () => {
  it('brings day totals, water and sleep once, and never over what the app already has', () => {
    const payload = { daily: {
      '2026-09-01': { weight: '84', protein: 150, carbs: '200,5', fat: 60, water: 2.5, sleep: 7 },
      '2026-09-02': { protein: 0, water: 3 },
      '2026-09-03': { notes: 'x' },
      'bozuk': { protein: 100 }
    } }
    const conv = convertTracker(payload)
    expect(conv.nutrition.map(n => n.d)).toEqual(['2026-09-01', '2026-09-02'])
    expect(conv.nutrition[0].item).toMatchObject({ id: 'tt-2026-09-01', p: 150, c: 200.5, f: 60 })
    expect(conv.nutrition[1].item).toBeNull()
    const S = clone(DEF)
    S.nutrition = { '2026-09-02': { p: 30, c: 0, f: 0, water: 1, _ts: 1 } }
    const r = applyTrackerImport(S, conv, { now: 'T' })
    expect(r.days).toBe(1)                                          // 09-02 already had its own water
    expect(S.nutrition['2026-09-01']).toMatchObject({ p: 150, c: 200.5, f: 60, water: 2.5, sleep: 7 })
    expect(S.nutrition['2026-09-01'].items).toBeUndefined()
    expect(S.nutrition['2026-09-02']).toMatchObject({ p: 30, water: 1 })   // the app's own values stay
    const again = applyTrackerImport(S, convertTracker(payload), { now: 'T2' })
    expect(again.days).toBe(0)
    expect(S.nutrition['2026-09-01'].p).toBe(150)
  })
})

describe('the coach\'s transfer of the tracker program', () => {
  it('stable routine ids, a starting week, and the member\'s own custom exercises reused', () => {
    const mine = { id: 'hist1', n: 'incline db press (30°)', custom: true }
    const plan = trackerPlan(PAYLOAD, [mine, { id: 'other', n: 'x', custom: true }])
    expect(plan.programName).toBe('Başlangıç - Tam Vücut')
    expect(plan.routines.map(r => r.id)).toEqual(['tt-p2-d1', 'tt-p2-d2'])
    expect(trackerPlan(PAYLOAD, [mine]).routines.map(r => r.id)).toEqual(['tt-p2-d1', 'tt-p2-d2'])   // again: same ids
    expect(plan.week).toEqual({ 1: ['tt-p2-d1'], 4: ['tt-p2-d2'] })
    expect(plan.routines[0].ex[1].id).toBe('hist1')
    expect(plan.customEx.map(c => c.id)).toEqual(['hist1'])
    expect(trackerPlan({}, [])).toBeNull()
  })
  it('spreads 1–7 days over the week', () => {
    expect(Object.keys(defaultWeek(['a', 'b', 'c'])).sort()).toEqual(['1', '3', '5'])
    expect(Object.keys(defaultWeek(['a', 'b', 'c', 'd', 'e'])).sort()).toEqual(['1', '2', '3', '4', '5'])
    expect(defaultWeek(Array.from({ length: 9 }, (_, i) => 'r' + i))[0]).toEqual(['r6'])
  })
})

describe('measurements from the tracker', () => {
  it('come over once, never over a day the app has', () => {
    const payload = { measurements: [{ id: '1', date: '2026-09-07', waistNavel: 86 }, { id: '2', date: '2026-09-14', waistNavel: 85 }] }
    const S = clone(DEF)
    S.measurements = [{ d: '2026-09-14', waistNavel: 84, t: 5 }]
    const r = applyTrackerImport(S, convertTracker(payload), { now: 'T' })
    expect(r.measurements).toBe(1)
    expect(S.measurements.map(m => [m.d, m.waistNavel])).toEqual([['2026-09-07', 86], ['2026-09-14', 84]])
    expect(applyTrackerImport(S, convertTracker(payload), { now: 'T2' }).measurements).toBe(0)
  })
})
