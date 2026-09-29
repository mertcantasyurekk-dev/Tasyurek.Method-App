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
  if (r.status === 404) return { exists: false, plan: null, rev: 0, updateTime: null }
  if (!r.ok) throw err(r.status, body?.error?.message || 'plan read failed')
  const f = body.fields || {}
  let plan = null
  try { plan = f.plan?.stringValue ? JSON.parse(f.plan.stringValue) : null } catch { plan = null }
  return { exists: true, plan, rev: Number(f.rev?.integerValue || 0), updateTime: body.updateTime }
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
  const state = p.plan ? applyPlan(og.state ? og.state : { lang: 'tr' }, p.plan) : og.state
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
  const text = JSON.stringify(state)
  if (text.length > MAX_STATE_BYTES) throw err(413, 'profile too large for one document')

  // The write only lands if nobody wrote since we read (Firestore's precondition): the same
  // compare-and-write the server does, across devices instead of inside one process.
  const pre = cur.exists
    ? 'currentDocument.updateTime=' + encodeURIComponent(cur.updateTime)
    : 'currentDocument.exists=false'
  const mask = 'updateMask.fieldPaths=state&updateMask.fieldPaths=rev&updateMask.fieldPaths=email&updateMask.fieldPaths=updatedAt'
  const { r, body: res } = await jsonFetch(`${docUrl(a.uid)}?${mask}&${pre}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a.idToken },
    body: JSON.stringify({ fields: {
      state: { stringValue: text },
      rev: { integerValue: String(nextRev) },
      email: { stringValue: a.email || '' },
      updatedAt: { timestampValue: new Date().toISOString() }
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

async function listDocs(a, collection, maskFields) {
  const out = []
  let token = ''
  const mask = (maskFields || []).map(f => '&mask.fieldPaths=' + encodeURIComponent(f)).join('')
  for (let page = 0; page < 20; page++) {
    const url = `${DOCS()}/${collection}?pageSize=300${mask}${token ? '&pageToken=' + encodeURIComponent(token) : ''}`
    const { r, body } = await jsonFetch(url, { headers: { Authorization: 'Bearer ' + a.idToken } })
    if (!r.ok) throw err(r.status, body?.error?.message || 'list failed')
    for (const d of body.documents || []) out.push({ id: decodeURIComponent(d.name.split('/').pop()), fields: d.fields || {}, updateTime: d.updateTime })
    if (!body.nextPageToken) break
    token = body.nextPageToken
  }
  return out
}

const parseState = f => { try { return f.state?.stringValue ? JSON.parse(f.state.stringValue) : null } catch { return null } }

// One line per member for the panel's list.
function summaryOf(state) {
  const ws = Array.isArray(state?.workouts) ? state.workouts : []
  const bw = Array.isArray(state?.bodyweight) ? state.bodyweight : []
  const last = ws.reduce((m, w) => (w?.d && (!m || w.d > m) ? w.d : m), null)
  const since = new Date(); since.setDate(since.getDate() - 7)
  const iso = since.toISOString().slice(0, 10)
  const lastBw = bw.reduce((m, b) => (b?.d && (!m || b.d > m.d) ? b : m), null)
  return { lastWorkout: last, workouts7: ws.filter(w => w?.d >= iso).length, workouts: ws.length, lastWeight: lastBw ? lastBw.w : null }
}

async function coachMembers(a) {
  const [users, states, plans] = await Promise.all([
    listDocs(a, 'userdata', ['displayName', 'email']),
    listDocs(a, CFG.collection),
    listDocs(a, 'coachplan', ['rev'])
  ])
  const og = new Map(states.map(d => [d.id, d]))
  const pl = new Map(plans.map(d => [d.id, d]))
  return users
    .filter(u => (u.fields.email?.stringValue || '').toLowerCase() !== CFG.adminEmail)
    .map(u => {
      const st = og.get(u.id)
      const email = u.fields.email?.stringValue || ''
      return {
        uid: u.id, email,
        name: u.fields.displayName?.stringValue || email.split('@')[0] || u.id,
        joined: !!st,                                   // has opened the new app
        ...summaryOf(st ? parseState(st.fields) : null),
        planAt: pl.get(u.id)?.updateTime || null
      }
    })
    .sort((x, y) => x.name.localeCompare(y.name, 'tr'))
}

async function coachMember(a, uid) {
  const { r, body } = await jsonFetch(docUrl(uid), { headers: { Authorization: 'Bearer ' + a.idToken } })
  if (!r.ok && r.status !== 404) throw err(r.status, body?.error?.message || 'read failed')
  const state = r.ok ? parseState(body.fields || {}) : null
  const p = await readPlan(a, uid)
  return { state, plan: p.plan, planRev: p.rev }
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
  const mask = ['plan', 'rev', 'updatedAt', 'by'].map(f => 'updateMask.fieldPaths=' + f).join('&')
  const { r, body: res } = await jsonFetch(`${planUrl(uid)}?${mask}&${pre}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a.idToken },
    body: JSON.stringify({ fields: {
      plan: { stringValue: text }, rev: { integerValue: String(cur.rev + 1) },
      updatedAt: { timestampValue: plan.updatedAt }, by: { stringValue: a.email || '' }
    } })
  })
  if (!r.ok) {
    if (r.status === 400 && /FAILED_PRECONDITION/.test(res?.error?.status || '')) throw err(409, 'the plan changed meanwhile — open it again')
    throw err(r.status, res?.error?.message || 'plan write failed')
  }
  return { ok: true, rev: cur.rev + 1, plan }
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
    case 'GET /api/coach/members':
      return { members: await coachMembers(await asCoach()) }
    case 'GET /api/coach/member': {
      const uid = new URLSearchParams(path.split('?')[1] || '').get('uid')
      if (!uid) throw err(400, 'uid required')
      return coachMember(await asCoach(), uid)
    }
    case 'PUT /api/coach/plan':
      return coachPutPlan(await asCoach(), body)
    case 'POST /api/activity':
      return { ok: true }   // the "who is training now" heartbeat has nobody to tell here
    default:
      throw err(404, 'not available')
  }
}
