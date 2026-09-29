// Taşyürek Method: the food list a member searches — the built-in Turkish list (src/data/foods-tr.json,
// loaded only when the food sheet opens) plus the shared list everyone adds to
// (sharedData/customFoods, the same one the old tracker keeps).
//
// A food, normalised: { id, n name, u 'g' (values per 100 g) | 'p' (per portion), l portion label,
// p c f grams, k kcal, own: true for the shared list }.
import { api } from './api.js'
import { kcalOf } from './nutrition-core.js'

const num = v => { const x = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(x) && x > 0 ? x : 0 }

export function normFood(raw, own = false) {
  if (!raw) return null
  // the built-in list's compact shape, or the tracker's { name, unit, portionLabel, protein, carbs, fat }
  const compact = 'n' in raw
  const f = compact
    ? { id: raw.id, n: raw.n, u: raw.u === 'p' ? 'p' : 'g', l: raw.l, p: num(raw.p), c: num(raw.c), f: num(raw.f) }
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
    const score = (name.startsWith(words[0]) ? 0 : name.includes(' ' + words[0]) ? 1 : 2) + name.length / 1000
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
export const perLine = food => `${food.u === 'g' ? '100 g' : food.l} · ${food.k} kcal · P ${food.p} · K ${food.c} · Y ${food.f}`

let base = null
let shared = null
export async function loadFoods({ refresh = false } = {}) {
  if (!base) base = (await import('../data/foods-tr.json')).default.map(r => normFood(r)).filter(Boolean)
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
