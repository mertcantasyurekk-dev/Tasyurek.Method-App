import { describe, it, expect } from 'vitest'
import { normFood, fold, searchFoods, macrosFor, defaultQty, perLine } from './foods.js'
import data from '../fooddata/foods-tr.json'

const list = data.map(r => normFood(r))

describe('the built-in list', () => {
  it('is the tracker\'s 118 foods plus the USDA basics, every one with macros', () => {
    expect(list.length).toBeGreaterThan(230)
    expect(new Set(list.map(f => f.id)).size).toBe(list.length)
    expect(new Set(list.map(f => fold(f.n))).size).toBe(list.length)
    for (const f of list) {
      expect(f.n).toBeTruthy()
      expect(f.p + f.c + f.f).toBeGreaterThan(0)
      if (f.u === 'p') expect(f.l).toBeTruthy()
    }
  })
})

describe('search', () => {
  it('ignores Turkish letters and case', () => {
    expect(fold('Tavuk Göğsü, IZGARA')).toBe('tavuk gogsu izgara')
    expect(fold('İrmik Helvası')).toBe('irmik helvasi')
  })
  it('finds by any order of words, closest first', () => {
    const hits = searchFoods(list, 'yumurta')
    expect(hits[0].n.toLowerCase()).toContain('yumurta')
    expect(searchFoods(list, 'peynir beyaz')[0].n).toBe('Beyaz peynir')
    expect(searchFoods(list, 'helvasi irmik')[0].n).toBe('İrmik Helvası')
    expect(searchFoods(list, 'zzzz')).toEqual([])
    expect(searchFoods(list, '', 5)).toHaveLength(5)
  })
})

describe('amounts', () => {
  it('per 100 g foods scale by grams, portion foods by count', () => {
    const cheese = list.find(f => f.id === 'white-cheese')
    expect(defaultQty(cheese)).toBe(100)
    expect(macrosFor(cheese, 50)).toEqual({ p: 7.5, c: 1.3, f: 10.5, kcal: 130 })
    const egg = list.find(f => f.id === 'egg')
    expect(defaultQty(egg)).toBe(1)
    expect(macrosFor(egg, 2)).toMatchObject({ p: 13, c: 1.2, f: 10.6 })
    expect(perLine(egg)).toContain('1 adet')
  })
  it('reads the tracker\'s own shape for shared foods', () => {
    const f = normFood({ id: 'x', name: 'Yemekhane mercimek', unit: 'portion', portionLabel: '1 kase', protein: 9, carbs: 20, fat: 4, kcal: 150 }, true)
    expect(f).toMatchObject({ n: 'Yemekhane mercimek', u: 'p', l: '1 kase', p: 9, own: true, k: 152 })
    expect(normFood({ name: '' })).toBeNull()
  })
})

describe('USDA basics', () => {
  it('match the reference values and carry handy servings', () => {
    const chicken = list.find(f => f.id === 'us05062')
    expect(chicken).toMatchObject({ n: 'Tavuk göğsü (çiğ)', u: 'g', p: 22.5, c: 0, f: 2.6 })
    const lentils = list.find(f => f.n === 'Mercimek (haşlanmış)')
    expect(lentils).toMatchObject({ p: 9, c: 20.1, f: 0.4 })
    const apple = list.find(f => f.n === 'Elma (100 g)')
    expect(apple.s).toEqual([['1 orta boy', 182]])
    expect(macrosFor(apple, 182).kcal).toBeGreaterThan(90)
    expect(searchFoods(list, 'kiyma').slice(0, 5).every(f => fold(f.n).split(' ').includes('kiyma'))).toBe(true)
    expect(searchFoods(list, 'tavuk gogsu').map(f => f.n)).toEqual(expect.arrayContaining(['Tavuk göğsü (ızgara)', 'Tavuk göğsü (çiğ)']))
  })
})
