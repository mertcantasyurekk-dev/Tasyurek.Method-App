// Taşyürek Method: the body weight is logged in the morning, on Home — never before a workout.
// A weigh-in taken just before training (after meals and water) pulls the weekly average up and
// makes the curve dishonest, so the Firebase build has no pre-workout check-in at all. A workout
// is stamped with the latest weigh-in of the last seven days instead (bodyweight exercises need it
// for their tonnage); with none in that window it carries no body weight, like a skipped check-in.
import { FIREBASE } from './firebase-api.js'

export const MORNING_WEIGH = FIREBASE

const isoMinus = (iso, n) => {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// The latest weigh-in on or before `day`, no older than `days` days (day itself counts as one).
export function recentWeight(S, day, days = 7) {
  const from = isoMinus(day, days - 1)
  let best = null
  for (const b of S?.bodyweight || []) {
    if (!b?.d || !(b.w > 0) || b.d > day || b.d < from) continue
    if (!best || b.d > best.d || (b.d === best.d && (b.t || 0) > (best.t || 0))) best = b
  }
  return best ? best.w : null
}

export const weighedOn = (S, day) => (S?.bodyweight || []).some(b => b?.d === day && b.w > 0)
