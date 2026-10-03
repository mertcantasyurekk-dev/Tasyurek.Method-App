// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { parseReps, readPayload, convertTracker, applyTrackerImport, trackerPlan, defaultWeek, verifyImport } from './tracker-import.js'
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
    expect(r1).toMatchObject({ routines: 2, workouts: 3, workoutsSkipped: 0, weights: 2, customs: 2 })   // the day with our own workout keeps the tracker's too
    expect(S.workouts.map(w => w.d)).toEqual(['2026-09-01', '2026-09-03', '2026-09-03', '2026-09-03'])
    expect(S.workouts.some(w => w.id === 'own')).toBe(true)
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
    expect(S.workouts.map(w => w.d)).toEqual(['2026-09-01', '2026-09-03', '2026-09-03', '2026-09-03', '2026-09-08'])
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
    expect(conv.nutrition.map(n => n.d)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03'])
    expect(conv.nutrition[2]).toMatchObject({ note: 'x', item: null })
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

describe('the same import twice', () => {
  it('gives tracker workouts stable ids', () => {
    const a = convertTracker({ workouts: [{ id: 'abc', date: '2026-09-01', exercises: [{ name: 'barbell bench press', sets: [{ weight: 50, reps: 5 }] }] }, { date: '2026-09-02', exercises: [{ name: 'barbell bench press', sets: [{ weight: 50, reps: 5 }] }] }] })
    const b = convertTracker({ workouts: [{ id: 'abc', date: '2026-09-01', exercises: [{ name: 'barbell bench press', sets: [{ weight: 50, reps: 5 }] }] }, { date: '2026-09-02', exercises: [{ name: 'barbell bench press', sets: [{ weight: 50, reps: 5 }] }] }] })
    expect(a.workouts.map(w => w.id)).toEqual(['tt-w-abc', 'tt-w-2026-09-02-1'])
    expect(b.workouts.map(w => w.id)).toEqual(a.workouts.map(w => w.id))
  })
})

describe('every kind of tracker record comes over', () => {
  const payload = {
    workouts: [{ id: 'w1', date: '2026-09-10', label: 'A', exercises: [{ name: 'barbell bench press', sets: [{ weight: '80', reps: '5' }] }] }],
    daily: {
      '2026-09-10': { weight: '81,2', protein: 150, carbs: 200, fat: 60, notes: 'Dizim biraz ağrıdı' },
      '2026-09-28': { notes: '' }
    },
    measurements: [{ id: 'm1', date: '2026-09-09', weight: '81.6', waistNavel: 90 }, { id: 'm2', date: '2026-09-10', weight: '99', chest: 100 }],
    customDayTypeChoice: { '2026-09-10': 'training', '2026-09-11': 'rest' },
    priorBests: { 'barbell bench press': '95', 'Hip Thrust (makine)': 140, bos: 0 }
  }
  const mealLog = {
    '2026-09-11': { breakfast: [{ name: 'Yumurta', unit: 'portion', portionLabel: '1 adet', qty: 2, protein: 13, carbs: 1, fat: 10 }], lunch: [], dinner: [], snacks: [] },
    '2026-09-29': { breakfast: [{ name: 'Yulaf', unit: '100g', qty: 80, protein: 10, carbs: 50, fat: 5 }], lunch: [{ name: 'Tavuk', unit: '100g', qty: 150, protein: 46, carbs: 0, fat: 5 }], dinner: [], snacks: [] }
  }
  const conv = convertTracker(payload, [], { timers: { '2026-09-10': { totalSec: 3720 } }, mealLog, today: '2026-09-30' })

  it('workout weights and durations', () => {
    const w = conv.workouts.find(x => x.id === 'tt-w-w1')
    expect(w.entries[0].sets).toEqual([{ w: 80, r: 5, done: true }])
    expect(w.end - w.start).toBe(3720 * 1000)
  })
  it('body weight from daily entries and from the measurement form', () => {
    expect(conv.bodyweight.map(b => [b.d, b.w])).toEqual([['2026-09-09', 81.6], ['2026-09-10', 81.2]])   // daily wins over the form
  })
  it('notes, day types, meals: this week as meals, earlier as day totals', () => {
    const by = Object.fromEntries(conv.nutrition.map(n => [n.d, n]))
    expect(by['2026-09-10']).toMatchObject({ note: 'Dizim biraz ağrıdı', type: 'training', item: { p: 150 } })
    expect(by['2026-09-11']).toMatchObject({ type: 'rest', item: { p: 13, c: 1, f: 10 }, items: null })        // an earlier week: the meal sum
    expect(by['2026-09-29'].items.map(i => [i.m, i.n, i.p])).toEqual([['b', 'Yulaf', 10], ['l', 'Tavuk', 46]])    // this week: the meals
    expect(by['2026-09-29'].item).toBeNull()
  })
  it('bests from before the tracker, in a marked session before the first workout', () => {
    const pb = conv.workouts.find(x => x.id === 'tt-w-prior-bests')
    expect(pb).toMatchObject({ d: '2026-09-09', name: 'Önceki rekorlar (tracker)' })
    expect(pb.entries.map(e => e.sets[0].w)).toEqual([95, 140])
    expect(conv.priorBests).toBe(2)
  })
  it('applies all of it, never over what the app already has', () => {
    const S = clone(DEF)
    S.nutrition = { '2026-09-29': { items: [{ id: 'mine', p: 20, c: 0, f: 0, t: 1 }], _ts: 1 } }
    S.dayNotes = { '2026-09-10': { text: 'benim notum', t: 1 } }
    applyTrackerImport(S, conv, { now: 'T' })
    expect(S.nutrition['2026-09-29'].items.map(i => i.id)).toEqual(['mine'])        // the app's own meals stay
    expect(S.nutrition['2026-09-11']).toMatchObject({ p: 13, type: 'rest' })
    expect(S.dayNotes['2026-09-10'].text).toBe('benim notum')
    expect(S.workouts.some(w => w.id === 'tt-w-prior-bests')).toBe(true)
    expect(S.bodyweight.length).toBe(2)
  })
})

describe('no loss on days that also have a workout here', () => {
  it('a tracker workout on a day the app already has one: both kept', () => {
    const S = clone(DEF)
    S.workouts = [{ id: 'mine', d: '2026-09-01', entries: [], prs: [] }]
    const conv = convertTracker({ workouts: [{ id: 'trk', date: '2026-09-01', exercises: [{ name: 'barbell bench press', sets: [{ weight: 60, reps: 8 }] }] }] })
    const r = applyTrackerImport(S, conv, { now: 'T' })
    expect(r.workouts).toBe(1)
    expect(S.workouts.map(w => w.id).sort()).toEqual(['mine', 'tt-w-trk'])
    expect(applyTrackerImport(S, conv, { now: 'T2' }).workouts).toBe(0)       // and never twice
  })
})

describe('verification after the import', () => {
  it('counts what came over, kind by kind, and says when something is missing', () => {
    const conv = convertTracker(PAYLOAD)
    const S = clone(DEF)
    expect(verifyImport(conv, S).ok).toBe(false)
    applyTrackerImport(S, conv, { now: 'T' })
    const v = verifyImport(conv, S)
    expect(v.ok).toBe(true)
    expect(v.rows.find(r => r.label === 'antrenman')).toMatchObject({ want: 3, got: 3, ok: true })
    S.workouts = S.workouts.slice(1)
    const v2 = verifyImport(conv, S)
    expect(v2.ok).toBe(false)
    expect(v2.rows.find(r => r.label === 'antrenman')).toMatchObject({ want: 3, got: 2, ok: false })
  })
})
