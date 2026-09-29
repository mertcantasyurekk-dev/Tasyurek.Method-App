// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { weekEnd, weekWindow, buildExport, parseRevise, checkRevise, autoDraft } from './coach360.js'

const TODAY = '2026-09-29'   // a Tuesday
const S = {
  customEx: [{ id: 'cx1', n: 'Incline DB Press (30°)', custom: true, bp: 'chest' }],
  routines: [{ id: 'r1', name: 'Gün 1', ex: [{ id: '0025', sets: 4, reps: 10, repsMin: 8, note: 'RIR 2' }, { id: 'cx1', sets: 3, reps: 10 }] }],
  week: { 1: ['r1'] },
  coachTargets: { training: { p: 180, c: 250, f: 60 }, rest: { p: 180, c: 150, f: 70 }, water: 3, sleep: 8 },
  bodyweight: [{ d: '2026-09-01', w: 86 }, { d: '2026-09-03', w: 85.6 }, { d: '2026-09-22', w: 84.4 }, { d: '2026-09-24', w: 84 }, { d: '2026-09-16', w: 85 }],
  workouts: [
    { d: '2026-09-01', name: 'Gün 1', entries: [{ id: '0025', sets: [{ w: 60, r: 10, done: true }, { w: 40, r: 10, done: true, phase: 'warmup' }] }] },
    { d: '2026-09-15', name: 'Gün 1', entries: [{ id: '0025', sets: [{ w: 65, r: 9, done: true }] }] },
    { d: '2026-09-22', name: 'Gün 1', note: 'omuz biraz ağrıdı', entries: [{ id: '0025', sets: [{ w: 70, r: 8, done: true }, { w: 70, r: 7, done: true }] }, { id: 'cx1', sets: [{ w: 24, r: 10, done: true }] }] }
  ],
  nutrition: {
    '2026-09-22': { p: 180, c: 250, f: 60, water: 3, sleep: 7.5 },
    '2026-09-23': { p: 160, c: 150, f: 70, sleep: 8 },
    '2026-09-16': { p: 100, c: 100, f: 30 }
  }
}

describe('weeks', () => {
  it('[N] is the Mon→Sun week that ended last Sunday, whatever day it is', () => {
    expect(weekEnd('2026-09-29')).toBe('2026-09-27')
    expect(weekEnd('2026-09-27')).toBe('2026-09-27')   // Sunday: today
    expect(weekEnd('2026-10-03')).toBe('2026-09-27')
    const { N, N1 } = weekWindow(TODAY)
    expect([N[0], N[6], N1[0], N1[6]]).toEqual(['2026-09-21', '2026-09-27', '2026-09-14', '2026-09-20'])
  })
})

describe('TT-VERI v1', () => {
  const out = buildExport({ uid: 'U1', name: 'Seda', email: 's@x.com', S, note: 'Sol diz: squat yok\nFMF', goal: 'Cut', today: TODAY })
  const lines = out.split('\n')
  it('keeps the header the analysis expects', () => {
    expect(lines[0]).toBe('=== TT-VERI v1 ===')
    expect(lines.at(-1)).toBe('=== /TT-VERI ===')
    expect(out).toContain('uid: U1')
    expect(out).toContain('üye: Seda (s@x.com)')
    expect(out).toContain('analiz_haftası: 2026-09-21 (Pzt) → 2026-09-27 (Paz)')
    expect(out).toContain('TT-REVIZE başlığında kullan: hafta=2026-09-27')
    expect(out).toContain('hedef: Cut')
    expect(out).toContain('kısıtlar_koç_notu:\n  Sol diz: squat yok\n  FMF')
    expect(out).toContain('antrenman günü seti: P 180 / K 250 / Y 60 (≈2260 kcal) | dinlenme günü seti: P 180 / K 150 / Y 70 (≈1950 kcal)')
    expect(out).toContain('su_hedefi: 3 L | uyku_hedefi: 8 sa')
    expect(out).toMatch(/Gün 1: .*4x8-10 \[RIR 2\]; Incline DB Press \(30°\) 3x10/)
  })
  it('baseline, N-1 and N from the new data', () => {
    expect(out).toContain('[BAŞLANGIÇ] ilk kayıt: 2026-09-01')
    expect(out).toContain('kilo: 85.8 kg (ilk kilo kaydından itibaren 7 gün ort., 2026-09-01 → 2026-09-07, 2 ölçüm)')
    const n = out.slice(out.indexOf('[N] '))
    expect(n).toContain('log günü: 3/7')
    expect(n).toContain('kilo ort: 84.2 kg (2 ölçüm)')
    expect(n).toContain('uyku ort: 7.8 sa | su ort: 3 L')
    expect(n).toMatch(/makro ort: P 170 \/ K 200 \/ Y 65 \(≈\d+ kcal, 2 gün makro kaydı\) \| hedefe uyum: %\d+/)
    expect(n).toContain('idman: 1 seans | toplam set: 3 |')
    expect(n).toMatch(/Barbell Bench Press: 70 x 8 \(e1RM≈89, 2 set, 09-22\)/i)
    expect(n).toContain('omuz biraz ağrıdı')
    const n1 = out.slice(out.indexOf('[N-1]'), out.indexOf('[N] '))
    expect(n1).toContain('idman: 1 seans')
    expect(n1).not.toContain('günlük notlar')
  })
  it('warm-up sets never count', () => {
    const base = out.slice(out.indexOf('[BAŞLANGIÇ]'), out.indexOf('[N-1]'))
    expect(base).toMatch(/Bench Press: 60 x 10/i)
  })
})

describe('TT-REVIZE', () => {
  const block = `blah\n[[TT-REVIZE uid=U1 hafta=2026-09-27]]\n##RAPOR\nKilo iyi gidiyor.\n##MESAJ\nHarika hafta Seda!\n##MAKRO\nantrenman: P 180 / K 240 / Y 60\ndinlenme: P 180 / K 160 / Y 65\n[[/TT-REVIZE]]\n`
  it('parses report, message and macros', () => {
    const r = parseRevise(block)
    expect(r).toMatchObject({ ok: true, uid: 'U1', week: '2026-09-27', report: 'Kilo iyi gidiyor.', message: 'Harika hafta Seda!' })
    expect(r.macro).toEqual({ training: { p: 180, c: 240, f: 60 }, rest: { p: 180, c: 160, f: 65 } })
  })
  it('refuses a block without uid, end or sections; ignores silly macros', () => {
    expect(parseRevise('[[TT-REVIZE hafta=2026-09-27]]\n##RAPOR\nx\n##MESAJ\ny\n[[/TT-REVIZE]]').error).toMatch(/uid/)
    expect(parseRevise('[[TT-REVIZE uid=U1]]\n##RAPOR\nx').error).toMatch(/sonu/)
    expect(parseRevise('[[TT-REVIZE uid=U1]]\n##MESAJ\ny\n[[/TT-REVIZE]]').error).toMatch(/RAPOR/)
    const silly = parseRevise('[[TT-REVIZE uid=U1]]\n##RAPOR\nx\n##MESAJ\ny\n##MAKRO\nantrenman: P 900 / K 200 / Y 60\n[[/TT-REVIZE]]')
    expect(silly.macro).toBeNull()
    expect(silly.macroWarning).toMatch(/makul/)
  })
  it('a block for another member is refused; an old week is a warning', () => {
    const r = parseRevise(block)
    expect(checkRevise(r, 'U2', TODAY).errors[0]).toMatch(/başka bir üye/)
    expect(checkRevise(r, 'U1', TODAY)).toEqual({ errors: [], warnings: [] })
    const old = parseRevise(block.replace('2026-09-27', '2026-08-30'))
    expect(checkRevise(old, 'U1', TODAY).warnings[0]).toMatch(/dışında/)
  })
})

describe('auto draft', () => {
  it('sums up the analysis week', () => {
    const d = autoDraft({ name: 'Seda', S, today: TODAY })
    expect(d).toContain('Merhaba Seda,')
    expect(d).toContain('• 1 antrenman')
    expect(d).toContain('• Ortalama kilo 84.2 kg')
  })
})

describe('measurements in the export', () => {
  it('first ever for the baseline, the last within each week', () => {
    const S2 = { ...S, measurements: [
      { d: '2026-09-01', waistNavel: 88, hips: 100, t: 1 },
      { d: '2026-09-16', waistNavel: 86.5, t: 2 },
      { d: '2026-09-23', waistNavel: 85.8, hips: 98, t: 3 }
    ] }
    const out = buildExport({ uid: 'U1', S: S2, today: TODAY })
    const base = out.slice(out.indexOf('[BAŞLANGIÇ]'), out.indexOf('[N-1]'))
    expect(base).toContain('ölçüler: bel-göbek 88 | kalça 100 (2026-09-01)')
    expect(out.slice(out.indexOf('[N-1]'), out.indexOf('[N] '))).toContain('ölçüler: bel-göbek 86.5 (2026-09-16)')
    expect(out.slice(out.indexOf('[N] '))).toContain('ölçüler: bel-göbek 85.8 | kalça 98 (2026-09-23)')
  })
})
