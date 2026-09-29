// Taşyürek Method: the food list a member searches — the built-in Turkish list (src/fooddata/foods-tr.json,
// loaded only when the food sheet opens) plus the shared list everyone adds to
// (sharedData/customFoods, the same one the old tracker keeps).
//
// A food, normalised: { id, n name, u 'g' (values per 100 g) | 'p' (per portion), l portion label,
// s [[label, grams]] handy servings of a per-100 g food ("1 orta boy", 182), p c f grams, k kcal,
// own: true for the shared list }.
// Built-in list: the tracker's 118 foods + ~120 basics from USDA SR28 (public domain), Turkish names.
// USDA carbohydrate is "by difference" (fibre included), as on US labels.
import { api } from './api.js'
import { kcalOf } from './nutrition-core.js'
import { fmtNum } from './format.js'

const num = v => { const x = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(x) && x > 0 ? x : 0 }

export function normFood(raw, own = false) {
  if (!raw) return null
  // the built-in list's compact shape, or the tracker's { name, unit, portionLabel, protein, carbs, fat }
  const compact = 'n' in raw
  const f = compact
    ? { id: raw.id, n: raw.n, u: raw.u === 'p' ? 'p' : 'g', l: raw.l, p: num(raw.p), c: num(raw.c), f: num(raw.f), ...(Array.isArray(raw.s) && raw.s.length ? { s: raw.s.filter(x => x && x[0] && num(x[1])) } : {}) }
    : { id: raw.id || 'u-' + raw.name, n: raw.name, u: raw.unit === 'portion' ? 'p' : 'g', l: raw.portionLabel, p: num(raw.protein), c: num(raw.carbs), f: num(raw.fat) }
  if (!f.n) return null
  if (f.u === 'p' && !f.l) f.l = '1 porsiyon'
  f.k = kcalOf(f)
  if (own) f.own = true
  return f
}

// "tavuk gogsu" finds "Tavuk göğsü": lower-case the Turkish way, then drop the marks.
export const fold = s => String(s || '').toLocaleLowerCase('tr')
  .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
  .replace(/[âà]/g, 'a').replace(/[îì]/g, 'i').replace(/[ûù]/g, 'u')
  .replace(/[^a-z0-9% ]+/g, ' ').replace(/\s+/g, ' ').trim()

export function searchFoods(list, q, limit = 60) {
  const words = fold(q).split(' ').filter(Boolean)
  if (!words.length) return list.slice(0, limit)
  const hits = []
  for (const f of list) {
    const name = f._fold || (f._fold = fold(f.n))
    if (!words.every(w => name.includes(w))) continue
    // A whole word first ("dana kıyma" for "kıyma"), then a word that starts with it ("kıymalı …"),
    // then anywhere; at the start of the name before later; shorter names first.
    const toks = name.split(' '), w = words[0]
    const score = (toks.includes(w) ? 0 : toks.some(x => x.startsWith(w)) ? 2 : 4) + (name.startsWith(w) ? 0 : 1) + name.length / 1000
    hits.push([score, f])
  }
  return hits.sort((a, b) => a[0] - b[0]).slice(0, limit).map(h => h[1])
}

// Macros for an amount: grams for a per-100 g food, portions for a per-portion one.
export function macrosFor(food, qty) {
  const q = num(qty)
  const k = food.u === 'g' ? q / 100 : q
  const m = { p: Math.round(food.p * k * 10) / 10, c: Math.round(food.c * k * 10) / 10, f: Math.round(food.f * k * 10) / 10 }
  return { ...m, kcal: kcalOf(m) }
}
export const defaultQty = food => (food.u === 'g' ? 100 : 1)
export const perLine = food => `${food.u === 'g' ? '100 g' : food.l} · ${fmtNum(food.k)} kcal · P ${fmtNum(food.p)} · K ${fmtNum(food.c)} · Y ${fmtNum(food.f)}`

let base = null
let shared = null
export async function loadFoods({ refresh = false } = {}) {
  if (!base) base = (await import('../fooddata/foods-tr.json')).default.map(r => normFood(r)).filter(Boolean)
  if (!shared || refresh) {
    try { shared = ((await api('/api/foods')).foods || []).map(r => normFood(r, true)).filter(Boolean) } catch { shared = shared || [] }
  }
  const names = new Set(base.map(f => fold(f.n)))
  return [...base, ...shared.filter(f => !names.has(fold(f.n)))]
}

export async function addSharedFood(food) {
  const r = await api('/api/foods', { method: 'POST', body: JSON.stringify({ food }) })
  shared = null
  return normFood(r.food, true)
}
