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

  const cur = await readDoc(a)
  if (body.baseRev != null && body.baseRev !== cur.rev) {
    throw err(409, 'conflict', { rev: cur.rev, state: cur.state })
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
      const now = await readDoc(a)
      throw err(409, 'conflict', { rev: now.rev, state: now.state })
    }
    throw err(r.status, res?.error?.message || 'write failed')
  }
  return { ok: true, ts: state._ts || null, rev: nextRev }
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
      const d = await readDoc(a)
      return { state: d.state, rev: d.rev }
    }
    case 'GET /api/data/rev': {
      const a = await idToken()
      return { rev: (await readDoc(a)).rev }
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
    case 'POST /api/activity':
      return { ok: true }   // the "who is training now" heartbeat has nobody to tell here
    default:
      throw err(404, 'not available')
  }
}
