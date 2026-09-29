import { describe, it, expect } from 'vitest'
import { normFood, fold, searchFoods, macrosFor, defaultQty, perLine } from './foods.js'
import data from '../data/foods-tr.json'

const list = data.map(r => normFood(r))

describe('the built-in list', () => {
  it('is the tracker\'s 118 foods, every one with macros that add up', () => {
    expect(list).toHaveLength(118)
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
