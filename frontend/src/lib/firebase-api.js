// Taşyürek Method — Firebase backend for openGym (VITE_FIREBASE=1).
//
// openGym talks to its own Node server through api() (lib/api.js). This build has no server: it is
// static on GitHub Pages, with Firebase Auth + Firestore behind it, reached over REST (the JS SDK
// dropped fields silently on some reads in the tracker this replaces — REST only, on purpose).
// firebaseApi() answers the same routes with the same shapes, so the store and the views run
// unchanged. Routes this backend does not have (passkeys, push, the admin dashboard, the AI Coach)
// answer 404, which every caller already treats as "this server does not offer that".
//
// Data: one document per member, ogstate/{uid} = { state: <JSON string>, rev: <int> }.
// The tracker's own userdata/{uid} is never read or written here, so the two apps cannot overwrite
// each other's data while both are in use.

import { compactNutrition } from './nutrition-core.js'   // the weekly seal: meals of past weeks are never stored
import { buildSummary } from './member-summary.js'      // the ~1 KB the coach panel reads instead of the state

export const FIREBASE = import.meta.env?.VITE_FIREBASE === '1'

const CFG = {
  apiKey: 'AIzaSyCChH0sUdkOsjLOuti_kc0VPh23I9-h7a8',
  projectId: 'tasyurekmethod-tracker',
  databaseId: 'default',            // no parentheses — this project's database id is literally "default"
  adminEmail: 'mertcan.tasyurekk@gmail.com',
  collection: 'ogstate'
}
const AUTH_KEY = 'tt-og-auth'       // never the tracker's keys (tasyurek-tracker-v1, tt-state-owner): same origin, same localStorage
const MAX_STATE_BYTES = 900 * 1024  // Firestore's document limit is 1 MiB; leave room for the envelope

const DOCS = () => `https://firestore.googleapis.com/v1/projects/${CFG.projectId}/databases/${CFG.databaseId}/documents`
const docUrl = uid => `${DOCS()}/${CFG.collection}/${encodeURIComponent(uid)}`

const err = (status, message, extra) => Object.assign(new Error(message), { status, data: { error: message, ...(extra || {}) } }, extra && extra.code ? { code: extra.code } : {})

/* ----------------------------------------------------------------- session -------------------- */

let fetchImpl = (...a) => globalThis.fetch(...a)
let storage = () => globalThis.localStorage
export function _setTestHooks(h) { if (h.fetch) fetchImpl = h.fetch; if (h.storage) storage = () => h.storage }

function readAuth() {
  try { const raw = storage().getItem(AUTH_KEY); return raw ? JSON.parse(raw) : null } catch { return null }
}
function writeAuth(a) {
  try { a ? storage().setItem(AUTH_KEY, JSON.stringify(a)) : storage().removeItem(AUTH_KEY) } catch { /* private mode */ }
}

async function jsonFetch(url, init) {
  const r = await fetchImpl(url, init)
  let body = null
  try { body = await r.json() } catch { /* empty */ }
  return { r, body }
}

// A Firebase ID token lives an hour. Refresh a minute early; a refresh token that is refused
// (password changed, account disabled) ends the session.
let refreshing = null
async function idToken() {
  const a = readAuth()
  if (!a) throw err(401, 'not signed in')
  if (Date.now() < a.exp - 60000) return a
  if (!refreshing) {
    refreshing = (async () => {
      const { r, body } = await jsonFetch(`https://securetoken.googleapis.com/v1/token?key=${CFG.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(a.refreshToken)
      })
      if (!r.ok || !body?.id_token) {
        // 400 from securetoken = the grant is dead. Anything else (5xx, offline) keeps the session.
        if (r.status === 400) { writeAuth(null); throw err(401, 'not signed in') }
        throw err(r.status || 0, 'token refresh failed')
      }
      const next = { ...a, idToken: body.id_token, refreshToken: body.refresh_token, exp: Date.now() + Number(body.expires_in) * 1000 }
      writeAuth(next)
      return next
    })().finally(() => { refreshing = null })
  }
  return refreshing
}

const isAdmin = a => (a.email || '').toLowerCase() === CFG.adminEmail
const userOf = a => ({
  id: a.uid,
  name: a.displayName || (a.email || '').split('@')[0],
  admin: (a.email || '').toLowerCase() === CFG.adminEmail
})

/* ----------------------------------------------------------------- firestore ------------------ */

async function readDoc(a) {
  const { r, body } = await jsonFetch(docUrl(a.uid), { headers: { Authorization: 'Bearer ' + a.idToken } })
  if (r.status === 404) return { exists: false, state: null, rev: 0, updateTime: null }
  if (!r.ok) throw err(r.status, body?.error?.message || 'read failed')
  const f = body.fields || {}
  let state = null
  if (f.state?.stringValue) {
    try { state = JSON.parse(f.state.stringValue) } catch { throw err(500, 'stored state is not valid JSON') }
  }
  const rev = Number(f.rev?.integerValue || 0)
  if (state) state._rev = rev
  // Meals of an earlier week are not kept: fold them into the day's totals (lib/nutrition-core.js).
  if (state) compactNutrition(state)
  // A profile that never picked a language is a Turkish one here (openGym's default is English).
  if (state && !state.lang) state.lang = 'tr'
  // Profiles saved before the brand accent existed carry openGym's green: move them to the gold
  // once. The stamp keeps a later choice of another colour from being undone.
  if (state && !state.brandAccent) { state.accent = 'brand'; state.brandAccent = 1 }
  return { exists: true, state, rev, updateTime: body.updateTime }
}

/* ------------------------------------------------------------ the coach's plan ---------------- */
// coachplan/{uid} = { plan: <JSON string: { routines, week, customEx, updatedAt }>, rev }. Only the
// coach writes it (Firestore rules); a member's app lays it over their own copy on every read, so
// the program they see is always the coach's and nothing they do can change it.
//
// openGym tells "something changed" by one number, the document's revision. A member's app must
// also notice when the coach changes the plan, so the revision it sees is the two combined:
// planRev * REV_SPAN + ogRev. PUT compares and answers in the same combined numbers.
const REV_SPAN = 1000000
const planUrl = uid => `${DOCS()}/coachplan/${encodeURIComponent(uid)}`

async function readPlan(a, uid = a.uid) {
  const { r, body } = await jsonFetch(planUrl(uid), { headers: { Authorization: 'Bearer ' + a.idToken } })
  if (r.status === 404) return { exists: false, plan: null, targets: null, reviews: null, supplements: null, rev: 0, updateTime: null }
  if (!r.ok) throw err(r.status, body?.error?.message || 'plan read failed')
  const f = body.fields || {}
  const json = v => { try { return v?.stringValue ? JSON.parse(v.stringValue) : null } catch { return null } }
  return { exists: true, plan: json(f.plan), targets: json(f.targets), reviews: json(f.reviews), supplements: json(f.supplements), rev: Number(f.rev?.integerValue || 0), updateTime: body.updateTime }
}

// The member's copy with the coach's program in place of their own routines and week.
export function applyPlan(state, plan) {
  if (!plan) return state
  const S = state || {}
  const planEx = Array.isArray(plan.customEx) ? plan.customEx : []
  const ids = new Set(planEx.map(c => c.id))
  S.routines = Array.isArray(plan.routines) ? plan.routines : []
  S.week = plan.week && typeof plan.week === 'object' ? plan.week : {}
  S.customEx = [...(Array.isArray(S.customEx) ? S.customEx.filter(c => !ids.has(c?.id)) : []), ...planEx]
  S.coachPlanAt = plan.updatedAt || null
  return S
}

// What a member's app is served: their document with the plan over it, and the combined revision.
async function readCombined(a) {
  const og = await readDoc(a)
  if (isAdmin(a)) return { og, planRev: 0, rev: og.rev, state: og.state }
  const p = await readPlan(a)
  const rev = p.rev * REV_SPAN + og.rev
  let state = og.state
  if (p.exists) {
    state = state || { lang: 'tr' }
    if (p.plan) applyPlan(state, p.plan)
    // The coach's nutrition targets: the member sees them, never sets them.
    if (p.targets) state.coachTargets = p.targets; else delete state.coachTargets
    // The coach's weekly messages, newest last.
    if (Array.isArray(p.reviews) && p.reviews.length) state.coachReviews = p.reviews; else delete state.coachReviews
    // The coach's supplement list for this member (the tracker's customSupplements shape).
    if (Array.isArray(p.supplements)) state.coachSupplements = p.supplements; else delete state.coachSupplements
  }
  // A coached member's sessions start from the coach's prescription, never from their last session.
  if (state && state.startFrom === 'last') state.startFrom = 'plan'
  if (state) state._rev = rev
  return { og, planRev: p.rev, rev, state }
}

const record = x => !!x && typeof x === 'object' && !Array.isArray(x)
const records = v => (Array.isArray(v) ? v.filter(record) : [])

// PUT /api/data, the server's rules (api/server.js) applied on the client.
async function putData(a, body) {
  const state = body?.state
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw err(400, 'state required')
  if (!Object.keys(state).some(k => k !== '_rev' && k !== '_ts')) throw err(400, 'state required')
  const list = v => v == null || Array.isArray(v)
  if (!list(state.workouts) || !list(state.routines)) throw err(400, 'invalid state')
  for (const k of ['workouts', 'routines']) if (Array.isArray(state[k])) state[k] = records(state[k])

  const both = await readCombined(a)
  const cur = both.og
  if (body.baseRev != null && body.baseRev !== both.rev) {
    throw err(409, 'conflict', { rev: both.rev, state: both.state })
  }
  delete state.active   // in-progress workouts stay device-local
  const storedReset = Number(cur.state?.resetAt) || 0
  if (storedReset > (Number(state.resetAt) || 0)) {
    state.resetAt = cur.state.resetAt
    if (cur.state.resetIds && typeof cur.state.resetIds === 'object') state.resetIds = cur.state.resetIds
    else delete state.resetIds
  }
  const nextRev = cur.rev + 1
  delete state._rev
  compactNutrition(state)   // what reaches Firestore holds past weeks as day totals only
  const text = JSON.stringify(state)
  if (text.length > MAX_STATE_BYTES) throw err(413, 'profile too large for one document')

  // The write only lands if nobody wrote since we read (Firestore's precondition): the same
  // compare-and-write the server does, across devices instead of inside one process.
  const pre = cur.exists
    ? 'currentDocument.updateTime=' + encodeURIComponent(cur.updateTime)
    : 'currentDocument.exists=false'
  const mask = 'updateMask.fieldPaths=state&updateMask.fieldPaths=rev&updateMask.fieldPaths=email&updateMask.fieldPaths=updatedAt&updateMask.fieldPaths=summary'
  let summary = null
  try { summary = JSON.stringify(buildSummary(state)) } catch { summary = null }
  const { r, body: res } = await jsonFetch(`${docUrl(a.uid)}?${mask}&${pre}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a.idToken },
    body: JSON.stringify({ fields: {
      state: { stringValue: text },
      rev: { integerValue: String(nextRev) },
      email: { stringValue: a.email || '' },
      updatedAt: { timestampValue: new Date().toISOString() },
      summary: summary ? { stringValue: summary } : { nullValue: null }
    } })
  })
  if (!r.ok) {
    // Lost the race between our read and our write: report it the way the server would.
    if (r.status === 400 && /FAILED_PRECONDITION/.test(res?.error?.status || '') || r.status === 409) {
      const now = await readCombined(a)
      throw err(409, 'conflict', { rev: now.rev, state: now.state })
    }
    throw err(r.status, res?.error?.message || 'write failed')
  }
  return { ok: true, ts: state._ts || null, rev: both.planRev * REV_SPAN + nextRev }
}

// The name the tracker greets them with lives in userdata/{uid}.displayName. Read that one field
// (mask), once, and keep it with the session. Nothing in this file ever writes to userdata/.
async function withName(a) {
  if (a.displayName) return a
  try {
    const url = `${DOCS()}/userdata/${encodeURIComponent(a.uid)}?mask.fieldPaths=displayName`
    const { r, body: d } = await jsonFetch(url, { headers: { Authorization: 'Bearer ' + a.idToken } })
    const n = r.ok && d?.fields?.displayName?.stringValue
    if (n) { a = { ...a, displayName: n }; writeAuth(a) }
  } catch { /* the e-mail prefix will do */ }
  return a
}

/* ----------------------------------------------------------------- coach routes --------------- */
// The coach's side. Firestore's rules are the real gate (only the coach may list members or write
// a plan); the checks here just answer early and clearly.

// Every document of a collection, through :runQuery — the call the old tracker's admin panel has
// always used against these rules. `maskFields` limits the fields returned.
async function listDocs(a, collection, maskFields) {
  const structuredQuery = { from: [{ collectionId: collection }] }
  if (maskFields?.length) structuredQuery.select = { fields: maskFields.map(f => ({ fieldPath: f })) }
  const { r, body } = await jsonFetch(`${DOCS()}:runQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a.idToken },
    body: JSON.stringify({ structuredQuery })
  })
  const msg = (!r.ok && (body?.error?.message || (Array.isArray(body) && body[0]?.error?.message))) || null
  if (!r.ok || !Array.isArray(body)) throw err(r.status || 500, `${collection} listelenemedi: ${msg || r.status}`)
  return body.filter(x => x?.document).map(x => ({ id: decodeURIComponent(x.document.name.split('/').pop()), fields: x.document.fields || {}, updateTime: x.document.updateTime }))
}

const parseState = f => { try { return f.state?.stringValue ? JSON.parse(f.state.stringValue) : null } catch { return null } }

async function coachMembers(a) {
  // Members come from userdata; the other two only fill in the summary. If one of those cannot be
  // read (a missing Firestore rule, say) the list still opens, with a warning naming the collection.
  const users = await listDocs(a, 'userdata', ['displayName', 'email'])
  const warnings = []
  const soft = p => p.catch(e => { warnings.push(e.message); return [] })
  // Only each member's ~1 KB summary, not their state (lib/member-summary.js).
  const [states, plans] = await Promise.all([soft(listDocs(a, CFG.collection, ['summary', 'rev'])), soft(listDocs(a, 'coachplan', ['planAt', 'targets']))])
  const og = new Map(states.map(d => [d.id, d]))
  const pl = new Map(plans.map(d => [d.id, d]))
  const json = v => { try { return v?.stringValue ? JSON.parse(v.stringValue) : null } catch { return null } }
  const out = []
  for (const u of users) {
    const email = u.fields.email?.stringValue || ''
    if (email.toLowerCase() === CFG.adminEmail) continue
    const st = og.get(u.id)
    let summary = st ? json(st.fields.summary) : null
    if (st && !summary) {
      // Saved before summaries existed: work it out from the state this once (next save writes it).
      try {
        const { r, body } = await jsonFetch(docUrl(u.id), { headers: { Authorization: 'Bearer ' + a.idToken } })
        if (r.ok) summary = buildSummary(parseState(body.fields || {}) || {})
      } catch { summary = null }
    }
    const p = pl.get(u.id)
    out.push({
      uid: u.id, email, name: u.fields.displayName?.stringValue || email.split('@')[0] || u.id,
      joined: !!st, summary,
      planAt: p?.fields?.planAt?.timestampValue || null,
      targets: json(p?.fields?.targets), hasTargets: !!p?.fields?.targets
    })
  }
  out.sort((x, y) => x.name.localeCompare(y.name, 'tr'))
  return warnings.length ? out.concat([{ _warnings: warnings }]) : out
}

async function coachMember(a, uid) {
  const { r, body } = await jsonFetch(docUrl(uid), { headers: { Authorization: 'Bearer ' + a.idToken } })
  if (!r.ok && r.status !== 404) throw err(r.status, body?.error?.message || 'read failed')
  const state = r.ok ? parseState(body.fields || {}) : null
  const p = await readPlan(a, uid)
  let info = { name: uid, email: '' }
  try {
    const u = await jsonFetch(`${DOCS()}/userdata/${encodeURIComponent(uid)}?mask.fieldPaths=displayName&mask.fieldPaths=email`, { headers: { Authorization: 'Bearer ' + a.idToken } })
    const f = u.r.ok ? u.body?.fields || {} : {}
    const email = f.email?.stringValue || ''
    info = { name: f.displayName?.stringValue || email.split('@')[0] || uid, email }
  } catch { /* the uid will do */ }
  return { info, state, plan: p.plan, targets: p.targets, reviews: p.reviews || [], supplements: Array.isArray(p.supplements) ? p.supplements : null, planRev: p.rev, trackerTargets: await trackerTargetsOf(a, uid) }
}

const cleanPlan = plan => {
  if (!plan || typeof plan !== 'object') throw err(400, 'plan required')
  const routines = records(plan.routines)
  if (!routines.length) throw err(400, 'a plan needs at least one routine')
  const ids = new Set(routines.map(r => r.id))
  const week = {}
  for (const [d, v] of Object.entries(plan.week || {})) {
    if (!/^[0-6]$/.test(d)) continue
    const list = [].concat(v || []).filter(id => ids.has(id))
    if (list.length) week[d] = list
  }
  return { routines, week, customEx: records(plan.customEx), updatedAt: new Date().toISOString() }
}

async function coachPutPlan(a, body) {
  const uid = String(body?.uid || '')
  if (!uid) throw err(400, 'uid required')
  const plan = cleanPlan(body.plan)
  const cur = await readPlan(a, uid)
  const pre = cur.exists ? 'currentDocument.updateTime=' + encodeURIComponent(cur.updateTime) : 'currentDocument.exists=false'
  const text = JSON.stringify(plan)
  if (text.length > MAX_STATE_BYTES) throw err(413, 'plan too large')
  const mask = ['plan', 'planAt', 'rev', 'updatedAt', 'by'].map(f => 'updateMask.fieldPaths=' + f).join('&')
  const { r, body: res } = await jsonFetch(`${planUrl(uid)}?${mask}&${pre}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a.idToken },
    body: JSON.stringify({ fields: {
      plan: { stringValue: text }, planAt: { timestampValue: plan.updatedAt }, rev: { integerValue: String(cur.rev + 1) },
      updatedAt: { timestampValue: plan.updatedAt }, by: { stringValue: a.email || '' }
    } })
  })
  if (!r.ok) {
    if (r.status === 400 && /FAILED_PRECONDITION/.test(res?.error?.status || '')) throw err(409, 'the plan changed meanwhile — open it again')
    throw err(r.status, res?.error?.message || 'plan write failed')
  }
  return { ok: true, rev: cur.rev + 1, plan }
}

// What the old tracker had (targets, customMacroTargets), so the coach can start from there.
async function trackerTargetsOf(a, uid) {
  try {
    const { r, body } = await jsonFetch(`${DOCS()}/userdata/${encodeURIComponent(uid)}?mask.fieldPaths=payload`, { headers: { Authorization: 'Bearer ' + a.idToken } })
    const pl = r.ok && body?.fields?.payload?.stringValue ? JSON.parse(body.fields.payload.stringValue) : null
    if (!pl) return null
    const cm = pl.customMacroTargets || {}, t = pl.targets || {}
    const set = x => (x && (x.protein || x.carbs || x.fat) ? { p: x.protein, c: x.carbs, f: x.fat } : null)
    const wk = pl.customWeeklyTargets || {}
    return { training: set(cm.trainingDay) || set(t), rest: set(cm.offDay), water: t.water || null, sleep: t.sleep || null,
      workoutsPerWeek: wk.workoutsPerWeek || null, cardioSessionsPerWeek: wk.cardioSessionsPerWeek || null, cardioMinutesPerWeek: wk.cardioMinutesPerWeek || null }
  } catch { return null }
}

// Sane bounds, the same the tracker's 360° import used: 0 < P ≤ 500, C ≤ 1000, F ≤ 300.
export function cleanTargets(t) {
  const num = (v, max) => { const x = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(x) && x > 0 && x <= max ? Math.round(x * 10) / 10 : null }
  const set = s => {
    if (!s) return null
    const o = { p: num(s.p, 500), c: num(s.c, 1000), f: num(s.f, 300) }
    return o.p && o.c && o.f ? o : null
  }
  const whole = (v, max) => { const x = num(v, max); return x ? Math.round(x) : null }
  const out = { training: set(t?.training), rest: set(t?.rest), water: num(t?.water, 10), sleep: num(t?.sleep, 14),
    workoutsPerWeek: whole(t?.workoutsPerWeek, 14), cardioSessionsPerWeek: whole(t?.cardioSessionsPerWeek, 21), cardioMinutesPerWeek: whole(t?.cardioMinutesPerWeek, 1500) }
  if (!out.training && !out.rest && !out.workoutsPerWeek && !out.cardioSessionsPerWeek && !out.cardioMinutesPerWeek) throw err(400, 'En az bir makro seti ya da haftalık hedef gerekli')
  return out
}

async function coachPutTargets(a, body) {
  const uid = String(body?.uid || '')
  if (!uid) throw err(400, 'uid required')
  const targets = { ...cleanTargets(body.targets), updatedAt: new Date().toISOString() }
  const cur = await readPlan(a, uid)
  const pre = cur.exists ? 'currentDocument.updateTime=' + encodeURIComponent(cur.updateTime) : 'currentDocument.exists=false'
  const mask = ['targets', 'rev', 'updatedAt', 'by'].map(f => 'updateMask.fieldPaths=' + f).join('&')
  const { r, body: res } = await jsonFetch(`${planUrl(uid)}?${mask}&${pre}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a.idToken },
    body: JSON.stringify({ fields: {
      targets: { stringValue: JSON.stringify(targets) }, rev: { integerValue: String(cur.rev + 1) },
      updatedAt: { timestampValue: targets.updatedAt }, by: { stringValue: a.email || '' }
    } })
  })
  if (!r.ok) {
    if (r.status === 400 && /FAILED_PRECONDITION/.test(res?.error?.status || '')) throw err(409, 'Hedefler bu arada değişti — tekrar aç')
    throw err(r.status, res?.error?.message || 'targets write failed')
  }
  return { ok: true, rev: cur.rev + 1, targets }
}

/* ------------------------------------------------------------ shared foods -------------------- */
// sharedData/customFoods = { items: [ { id, name, unit: '100g' | 'portion', portionLabel, kcal,
// protein, carbs, fat } ] } — the list the old tracker already keeps, so both apps share it.

const fromFs = v => {
  if (!v || typeof v !== 'object') return null
  if ('stringValue' in v) return v.stringValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return Number(v.doubleValue)
  if ('booleanValue' in v) return v.booleanValue
  if ('nullValue' in v) return null
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFs)
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fromFs(x)]))
  return null
}
const toFs = v => {
  if (v === null || v === undefined) return { nullValue: null }
  if (typeof v === 'string') return { stringValue: v }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } }
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toFs(x)])) } }
}
const FOODS_URL = () => `${DOCS()}/sharedData/customFoods`

async function readFoods(a) {
  const { r, body } = await jsonFetch(FOODS_URL(), { headers: { Authorization: 'Bearer ' + a.idToken } })
  if (r.status === 404) return { exists: false, items: [], updateTime: null }
  if (!r.ok) throw err(r.status, body?.error?.message || 'foods read failed')
  const items = fromFs(body.fields?.items)
  return { exists: true, items: Array.isArray(items) ? items.filter(x => x && x.name) : [], updateTime: body.updateTime }
}

export function cleanFood(f) {
  const name = String(f?.name || '').trim().slice(0, 80)
  const g = (v, max) => { const x = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(x) && x >= 0 && x <= max ? Math.round(x * 10) / 10 : null }
  const unit = f?.unit === 'portion' ? 'portion' : '100g'
  const out = { id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, unit, protein: g(f?.protein, 200), carbs: g(f?.carbs, 300), fat: g(f?.fat, 150) }
  if (!name) throw err(400, 'Yemeğin adı gerekli')
  if (out.protein == null || out.carbs == null || out.fat == null || !(out.protein + out.carbs + out.fat)) throw err(400, 'Protein, karbonhidrat ve yağ değerlerini gir')
  if (unit === 'portion') out.portionLabel = String(f?.portionLabel || '1 porsiyon').trim().slice(0, 40) || '1 porsiyon'
  out.kcal = Math.round(out.protein * 4 + out.carbs * 4 + out.fat * 9)
  return out
}

async function addSharedFood(a, food) {
  const clean = cleanFood(food)
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await readFoods(a)
    const same = cur.items.find(x => x.name.toLocaleLowerCase('tr') === clean.name.toLocaleLowerCase('tr'))
    if (same) return { ok: true, food: same, existed: true }
    const pre = cur.exists ? 'currentDocument.updateTime=' + encodeURIComponent(cur.updateTime) : 'currentDocument.exists=false'
    const { r, body: res } = await jsonFetch(`${FOODS_URL()}?updateMask.fieldPaths=items&${pre}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a.idToken },
      body: JSON.stringify({ fields: { items: toFs([...cur.items, clean]) } })
    })
    if (r.ok) return { ok: true, food: clean, existed: false }
    if (!(r.status === 400 && /FAILED_PRECONDITION/.test(res?.error?.status || ''))) throw err(r.status, res?.error?.message || 'foods write failed')
    // someone else added a food meanwhile: read again and retry
  }
  throw err(409, 'Liste şu an meşgul, tekrar dene')
}

/* ------------------------------------------------------------ coach's own notes ---------------- */
// coachnotes/{uid} = { note, goal, reports: <JSON [{ week, text, message, macro, importedAt }]> }.
// Only the coach reads or writes it (rules): a member never sees their own health note or reports.
const notesUrl = uid => `${DOCS()}/coachnotes/${encodeURIComponent(uid)}`

async function readNotes(a, uid) {
  const { r, body } = await jsonFetch(notesUrl(uid), { headers: { Authorization: 'Bearer ' + a.idToken } })
  if (r.status === 404) return { exists: false, note: '', goal: '', reports: [], updateTime: null }
  if (!r.ok) throw err(r.status, body?.error?.message || 'notes read failed')
  const f = body.fields || {}
  let reports = []
  try { reports = f.reports?.stringValue ? JSON.parse(f.reports.stringValue) : [] } catch { reports = [] }
  return { exists: true, note: f.note?.stringValue || '', goal: f.goal?.stringValue || '', reports: Array.isArray(reports) ? reports : [], updateTime: body.updateTime }
}

// Patch the coach's notes: { note?, goal?, addReport? }. Read-modify-write under a precondition.
async function writeNotes(a, uid, patch) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await readNotes(a, uid)
    const next = { note: cur.note, goal: cur.goal, reports: cur.reports }
    if (typeof patch.note === 'string') next.note = patch.note.slice(0, 5000)
    if (typeof patch.goal === 'string') next.goal = patch.goal.slice(0, 40)
    if (patch.addReport) {
      const r = patch.addReport
      next.reports = [...next.reports, { week: r.week || null, text: String(r.text || '').slice(0, 20000), message: String(r.message || '').slice(0, 8000), macro: r.macro || null, importedAt: new Date().toISOString() }].slice(-60)
    }
    if (Array.isArray(patch.replaceReports)) next.reports = patch.replaceReports.slice(-60)
    const pre = cur.exists ? 'currentDocument.updateTime=' + encodeURIComponent(cur.updateTime) : 'currentDocument.exists=false'
    const { r, body: res } = await jsonFetch(`${notesUrl(uid)}?updateMask.fieldPaths=note&updateMask.fieldPaths=goal&updateMask.fieldPaths=reports&${pre}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a.idToken },
      body: JSON.stringify({ fields: { note: { stringValue: next.note }, goal: { stringValue: next.goal }, reports: { stringValue: JSON.stringify(next.reports) } } })
    })
    if (r.ok) return { ok: true, ...next }
    if (!(r.status === 400 && /FAILED_PRECONDITION/.test(res?.error?.status || ''))) throw err(r.status, res?.error?.message || 'notes write failed')
  }
  throw err(409, 'Notlar bu arada değişti — tekrar dene')
}

// Weekly messages to the member, on the plan document the member reads.
async function sendReview(a, uid, { text, week, remove, sentAt }) {
  const cur = await readPlan(a, uid)
  let reviews = Array.isArray(cur.reviews) ? cur.reviews : []
  if (remove) reviews = reviews.filter(x => x.id !== remove)
  else {
    const t = String(text || '').trim()
    if (!t) throw err(400, 'Mesaj boş')
    // sentAt is only given when bringing old messages over from the tracker: they keep their date.
    const at = sentAt && !isNaN(Date.parse(sentAt)) && Date.parse(sentAt) <= Date.now() ? new Date(sentAt).toISOString() : new Date().toISOString()
    // A message brought over from the tracker keeps its date and is marked, so it is not shown as new.
    reviews = [...reviews, { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), text: t.slice(0, 8000), week: week || null, sentAt: at, ...(sentAt ? { imported: true } : {}) }]
      .sort((x, y) => ((x.sentAt || '') < (y.sentAt || '') ? -1 : 1)).slice(-52)
  }
  const pre = cur.exists ? 'currentDocument.updateTime=' + encodeURIComponent(cur.updateTime) : 'currentDocument.exists=false'
  const { r, body: res } = await jsonFetch(`${planUrl(uid)}?updateMask.fieldPaths=reviews&updateMask.fieldPaths=rev&${pre}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a.idToken },
    body: JSON.stringify({ fields: { reviews: { stringValue: JSON.stringify(reviews) }, rev: { integerValue: String(cur.rev + 1) } } })
  })
  if (!r.ok) {
    if (r.status === 400 && /FAILED_PRECONDITION/.test(res?.error?.status || '')) throw err(409, 'Bu arada başka bir değişiklik oldu — tekrar gönder')
    throw err(r.status, res?.error?.message || 'review write failed')
  }
  return { ok: true, reviews }
}

// What the old tracker kept for the coach, to bring over once.
async function trackerExtras(a, uid) {
  const fields = ['coachNote', 'coachGoal', 'coachReports', 'weeklyRevisions', 'customSupplements'].map(f => 'mask.fieldPaths=' + f).join('&')
  const { r, body } = await jsonFetch(`${DOCS()}/userdata/${encodeURIComponent(uid)}?${fields}`, { headers: { Authorization: 'Bearer ' + a.idToken } })
  if (!r.ok) return { note: '', goal: '', reports: [], reviews: [], supplements: [] }
  const f = body.fields || {}
  const reports = (fromFs(f.coachReports) || []).filter(x => x && x.text).map(x => ({ week: x.week || null, text: x.text, message: x.message || '', macro: x.macro || null, importedAt: x.importedAt || null }))
  const reviews = (fromFs(f.weeklyRevisions) || []).filter(x => x && x.text).map((x, i) => ({ id: 'tt' + i, text: x.text, week: null, sentAt: x.sentAt || null }))
  const supplements = cleanSupplements(fromFs(f.customSupplements) || [])
  return { note: fromFs(f.coachNote) || '', goal: fromFs(f.coachGoal) || '', reports, reviews, supplements }
}

/* ------------------------------------------------------------ backups -------------------------- */
// Everything, as Firestore keeps it (typed fields), so a restore can put it back exactly:
// the tracker's userdata, this app's ogstate / coachplan / coachnotes, and the shared food list.
// Automatic copies go to backups/og_YYYY-MM-DD (the tracker's own are backup_YYYY-MM-DD and are
// left alone); over 800 KB a copy is split per member (og_DATE__<uid> parts + a main document), as
// the tracker does. The last BACKUP_KEEP copies are kept. backups/_og_meta remembers the last one.
const BACKUP_COLLECTIONS = ['userdata', 'ogstate', 'coachplan', 'coachnotes']
const BACKUP_SPLIT = 800 * 1024
const BACKUP_KEEP = 15
const BACKUP_EVERY_DAYS = 2
const backupUrl = id => `${DOCS()}/backups/${encodeURIComponent(id)}`
const localIso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

async function backupData(a) {
  const out = { app: 'tasyurek-method', version: 1, createdAt: new Date().toISOString(), collections: {} }
  for (const c of BACKUP_COLLECTIONS) {
    out.collections[c] = Object.fromEntries((await listDocs(a, c)).map(d => [d.id, d.fields]))
  }
  const foods = await jsonFetch(FOODS_URL(), { headers: { Authorization: 'Bearer ' + a.idToken } })
  out.collections.sharedData = { customFoods: foods.r.ok ? foods.body.fields || {} : {} }
  return out
}

async function putDoc(a, url, fields) {
  const { r, body } = await jsonFetch(url, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a.idToken }, body: JSON.stringify({ fields })
  })
  if (!r.ok) throw err(r.status, 'Yedek yazılamadı: ' + (body?.error?.message || r.status))
}

async function readBackupMeta(a) {
  const { r, body } = await jsonFetch(backupUrl('_og_meta'), { headers: { Authorization: 'Bearer ' + a.idToken } })
  if (!r.ok) return null
  const f = body.fields || {}
  return { lastDay: f.lastDay?.stringValue || null, lastId: f.lastId?.stringValue || null, lastAt: f.lastAt?.timestampValue || null, bytes: Number(f.bytes?.integerValue || 0) }
}

export const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000)

// Writes today's copy. Returns { id, bytes, parts }.
async function writeBackup(a) {
  const data = await backupData(a)
  const day = localIso()
  const id = 'og_' + day
  const text = JSON.stringify(data)
  const at = { timestampValue: data.createdAt }
  let parts = []
  if (text.length <= BACKUP_SPLIT) {
    await putDoc(a, backupUrl(id), { kind: { stringValue: 'og' }, day: { stringValue: day }, createdAt: at, bytes: { integerValue: String(text.length) }, data: { stringValue: text } })
  } else {
    // One part per member (all their documents), the shared food list in the main document.
    const uids = new Set(BACKUP_COLLECTIONS.flatMap(c => Object.keys(data.collections[c] || {})))
    for (const uid of uids) {
      const part = { collections: Object.fromEntries(BACKUP_COLLECTIONS.map(c => [c, data.collections[c]?.[uid] ? { [uid]: data.collections[c][uid] } : {}])) }
      const partText = JSON.stringify(part)
      if (partText.length > 1000 * 1024) throw err(413, `Yedek: ${uid} tek başına çok büyük (${Math.round(partText.length / 1024)} KB)`)
      const pid = `${id}__${uid}`
      await putDoc(a, backupUrl(pid), { kind: { stringValue: 'og-part' }, day: { stringValue: day }, createdAt: at, data: { stringValue: partText } })
      parts.push(pid)
    }
    const main = JSON.stringify({ ...data, collections: { sharedData: data.collections.sharedData } })
    await putDoc(a, backupUrl(id), {
      kind: { stringValue: 'og' }, day: { stringValue: day }, createdAt: at, bytes: { integerValue: String(text.length) }, data: { stringValue: main },
      split: { booleanValue: true }, parts: { arrayValue: { values: parts.map(p => ({ stringValue: p })) } }
    })
  }
  await putDoc(a, backupUrl('_og_meta'), { lastDay: { stringValue: day }, lastId: { stringValue: id }, lastAt: at, bytes: { integerValue: String(text.length) } })
  // Keep the last BACKUP_KEEP copies of this app (and their parts); never touch the tracker's.
  const all = (await listDocs(a, 'backups', ['kind', 'day'])).filter(d => /^og_\d{4}-\d{2}-\d{2}/.test(d.id))
  const days = [...new Set(all.map(d => d.id.slice(3, 13)))].sort()
  const drop = new Set(days.slice(0, Math.max(0, days.length - BACKUP_KEEP)))
  for (const d of all.filter(x => drop.has(x.id.slice(3, 13)))) {
    await jsonFetch(backupUrl(d.id), { method: 'DELETE', headers: { Authorization: 'Bearer ' + a.idToken } })
  }
  return { id, bytes: text.length, parts: parts.length }
}

async function listBackups(a) {
  const all = await listDocs(a, 'backups', ['kind', 'day', 'createdAt', 'bytes', 'split'])
  return all.filter(d => d.fields.kind?.stringValue === 'og')
    .map(d => ({ id: d.id, day: d.fields.day?.stringValue, createdAt: d.fields.createdAt?.timestampValue || null, bytes: Number(d.fields.bytes?.integerValue || 0), split: !!d.fields.split?.booleanValue }))
    .sort((x, y) => (x.id < y.id ? 1 : -1))
}

// A member's supplement list: groups of items, the tracker's customSupplements shape.
export function cleanSupplements(list) {
  const s = (v, n) => String(v ?? '').trim().slice(0, n)
  return (Array.isArray(list) ? list : []).map((g, gi) => ({
    id: s(g?.id, 40) || 'g' + gi, label: s(g?.label, 80) || 'Takviyeler',
    items: (Array.isArray(g?.items) ? g.items : []).map((i, ii) => ({ id: s(i?.id, 40) || `g${gi}i${ii}`, name: s(i?.name, 80), dose: s(i?.dose, 120) })).filter(i => i.name).slice(0, 30)
  })).filter(g => g.items.length).slice(0, 12)
}

async function coachPutSupplements(a, body) {
  const uid = String(body?.uid || '')
  if (!uid) throw err(400, 'uid required')
  const list = cleanSupplements(body.supplements)
  const cur = await readPlan(a, uid)
  const pre = cur.exists ? 'currentDocument.updateTime=' + encodeURIComponent(cur.updateTime) : 'currentDocument.exists=false'
  const { r, body: res } = await jsonFetch(`${planUrl(uid)}?updateMask.fieldPaths=supplements&updateMask.fieldPaths=rev&${pre}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a.idToken },
    body: JSON.stringify({ fields: { supplements: { stringValue: JSON.stringify(list) }, rev: { integerValue: String(cur.rev + 1) } } })
  })
  if (!r.ok) {
    if (r.status === 400 && /FAILED_PRECONDITION/.test(res?.error?.status || '')) throw err(409, 'Bu arada başka bir değişiklik oldu — tekrar kaydet')
    throw err(r.status, res?.error?.message || 'supplements write failed')
  }
  return { ok: true, supplements: list }
}

async function asCoach() {
  const a = await idToken()
  if (!isAdmin(a)) throw err(403, 'coach only')
  return a
}

/* ----------------------------------------------------------------- routes --------------------- */

async function signIn(body) {
  const email = String(body?.name || '').trim()
  const password = String(body?.password || '')
  if (!email.includes('@')) throw err(401, 'bad credentials', { code: 'bad-credentials' })
  const { r, body: res } = await jsonFetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${CFG.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  })
  if (!r.ok || !res?.idToken) {
    const m = res?.error?.message || ''
    if (/TOO_MANY_ATTEMPTS/.test(m)) throw err(429, 'too many attempts', { code: 'rate-limited' })
    throw err(401, 'bad credentials', { code: 'bad-credentials' })
  }
  const a = {
    uid: res.localId, email: res.email, displayName: res.displayName || '',
    idToken: res.idToken, refreshToken: res.refreshToken, exp: Date.now() + Number(res.expiresIn) * 1000
  }
  writeAuth(a)
  return { ok: true, user: userOf(await withName(a)) }
}

export async function firebaseApi(path, init = {}) {
  const method = (init.method || 'GET').toUpperCase()
  const route = method + ' ' + path.split('?')[0]
  const body = init.body ? JSON.parse(init.body) : null

  switch (route) {
    case 'GET /api/config':
      // Password sign-in only (existing Firebase accounts), no guest mode, no sign-up: the coach
      // creates members in Firebase Auth.
      return { invite_only: true, allow_guest: false, password_login: true, default_lang: 'tr' }
    case 'POST /api/login/password':
      return signIn(body)
    case 'POST /api/logout':
    case 'POST /api/logout/all':
      writeAuth(null)
      return { ok: true }
    case 'GET /api/me': {
      const a = await withName(await idToken())
      return { user: userOf(a) }
    }
    case 'GET /api/data': {
      const a = await idToken()
      const d = await readCombined(a)
      return { state: d.state, rev: d.rev }
    }
    case 'GET /api/data/rev': {
      const a = await idToken()
      return { rev: (await readCombined(a)).rev }
    }
    case 'PUT /api/data': {
      const a = await idToken()
      return putData(a, body)
    }
    case 'GET /api/tracker': {
      // The old tracker's payload, for the one-way import (lib/tracker-import.js). Read with a
      // field mask; this file never writes to userdata/.
      const a = await idToken()
      const url = `${DOCS()}/userdata/${encodeURIComponent(a.uid)}?mask.fieldPaths=payload`
      const { r, body: d } = await jsonFetch(url, { headers: { Authorization: 'Bearer ' + a.idToken } })
      if (r.status === 404) return { payload: null }
      if (!r.ok) throw err(r.status, d?.error?.message || 'read failed')
      return { payload: d?.fields?.payload?.stringValue || null }
    }
    case 'GET /api/coach/members': {
      const all = await coachMembers(await asCoach())
      const w = all.find(x => x._warnings)
      return { members: all.filter(x => !x._warnings), warnings: w ? w._warnings : [] }
    }
    case 'GET /api/coach/member': {
      const uid = new URLSearchParams(path.split('?')[1] || '').get('uid')
      if (!uid) throw err(400, 'uid required')
      return coachMember(await asCoach(), uid)
    }
    case 'GET /api/coach/notes': {
      const uid = new URLSearchParams(path.split('?')[1] || '').get('uid')
      if (!uid) throw err(400, 'uid required')
      const n = await readNotes(await asCoach(), uid)
      return { note: n.note, goal: n.goal, reports: n.reports }
    }
    case 'PUT /api/coach/notes': {
      if (!body?.uid) throw err(400, 'uid required')
      return writeNotes(await asCoach(), String(body.uid), body)
    }
    case 'PUT /api/coach/review': {
      if (!body?.uid) throw err(400, 'uid required')
      return sendReview(await asCoach(), String(body.uid), body)
    }
    case 'GET /api/coach/backup/data':
      return backupData(await asCoach())
    case 'GET /api/coach/backups': {
      const a = await asCoach()
      return { meta: await readBackupMeta(a), backups: await listBackups(a) }
    }
    case 'POST /api/coach/backup': {
      // { force } — without it, only when the last copy is BACKUP_EVERY_DAYS or more calendar days old.
      const a = await asCoach()
      const meta = await readBackupMeta(a)
      if (!body?.force && meta?.lastDay && daysBetween(meta.lastDay, localIso()) < BACKUP_EVERY_DAYS) return { skipped: true, meta }
      return { skipped: false, ...(await writeBackup(a)) }
    }
    case 'GET /api/coach/tracker-payload': {
      // A member's tracker payload, for transferring their program. Read-only (field mask).
      const uid = new URLSearchParams(path.split('?')[1] || '').get('uid')
      if (!uid) throw err(400, 'uid required')
      const a = await asCoach()
      const { r, body: d } = await jsonFetch(`${DOCS()}/userdata/${encodeURIComponent(uid)}?mask.fieldPaths=payload`, { headers: { Authorization: 'Bearer ' + a.idToken } })
      if (r.status === 404) return { payload: null }
      if (!r.ok) throw err(r.status, d?.error?.message || 'read failed')
      return { payload: d?.fields?.payload?.stringValue || null }
    }
    case 'GET /api/coach/tracker-extra': {
      const uid = new URLSearchParams(path.split('?')[1] || '').get('uid')
      if (!uid) throw err(400, 'uid required')
      return trackerExtras(await asCoach(), uid)
    }
    case 'PUT /api/coach/supplements':
      return coachPutSupplements(await asCoach(), body)
    case 'PUT /api/coach/targets':
      return coachPutTargets(await asCoach(), body)
    case 'PUT /api/coach/plan':
      return coachPutPlan(await asCoach(), body)
    case 'GET /api/foods':
      return { foods: (await readFoods(await idToken())).items }
    case 'POST /api/foods':
      return addSharedFood(await idToken(), body?.food)
    case 'POST /api/activity':
      return { ok: true }   // the "who is training now" heartbeat has nobody to tell here
    default:
      throw err(404, 'not available')
  }
}
