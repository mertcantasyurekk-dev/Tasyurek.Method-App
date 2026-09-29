import { describe, it, expect, beforeEach } from 'vitest'
import { firebaseApi, _setTestHooks } from './firebase-api.js'

// In-memory Firebase: identitytoolkit, securetoken and one Firestore collection.
function fakeFirebase() {
  const docs = new Map()          // path -> { fields, updateTime }
  let clock = 0
  const users = { 'uye@x.com': { pw: 'dogru', uid: 'U1' }, 'mertcan.tasyurekk@gmail.com': { pw: 'a', uid: 'ADM' } }
  const calls = []
  let beforeWrite = null           // lets a test slip in another device's write
  const res = (status, body) => ({ ok: status < 300, status, json: async () => body })
  async function fetch(url, init = {}) {
    calls.push({ url, init })
    const u = new URL(url)
    if (u.host === 'identitytoolkit.googleapis.com') {
      const b = JSON.parse(init.body); const x = users[b.email]
      if (!x || x.pw !== b.password) return res(400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } })
      return res(200, { localId: x.uid, email: b.email, idToken: 'tok-' + x.uid, refreshToken: 'ref-' + x.uid, expiresIn: '3600' })
    }
    if (u.host === 'securetoken.googleapis.com') {
      const rt = new URLSearchParams(init.body).get('refresh_token')
      if (!rt.startsWith('ref-')) return res(400, { error: { message: 'INVALID_REFRESH_TOKEN' } })
      return res(200, { id_token: 'tok2', refresh_token: rt, expires_in: '3600' })
    }
    const path = u.pathname.split('/documents/')[1]
    const cur = docs.get(path)
    if ((init.method || 'GET') === 'GET') return cur ? res(200, { fields: cur.fields, updateTime: cur.updateTime }) : res(404, {})
    if (init.method === 'PATCH') {
      if (beforeWrite) { const f = beforeWrite; beforeWrite = null; f(docs, path) }
      const now = docs.get(path)
      const ut = u.searchParams.get('currentDocument.updateTime')
      const ex = u.searchParams.get('currentDocument.exists')
      if ((ut && (!now || now.updateTime !== ut)) || (ex === 'false' && now)) return res(400, { error: { status: 'FAILED_PRECONDITION' } })
      const fields = { ...(now?.fields || {}), ...JSON.parse(init.body).fields }
      const doc = { fields, updateTime: 't' + (++clock) }
      docs.set(path, doc)
      return res(200, doc)
    }
    return res(405, {})
  }
  return { fetch, docs, calls, setBeforeWrite: f => { beforeWrite = f }, bump: () => 't' + (++clock) }
}
function memStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m } }

const post = (p, b) => firebaseApi(p, { method: 'POST', body: JSON.stringify(b) })
const put = b => firebaseApi('/api/data', { method: 'PUT', body: JSON.stringify(b) })

let fb, st
beforeEach(() => { fb = fakeFirebase(); st = memStorage(); _setTestHooks({ fetch: fb.fetch, storage: st }) })

describe('Firebase adapter', () => {
  it('offers password sign-in only, in Turkish', async () => {
    const c = await firebaseApi('/api/config')
    expect(c).toMatchObject({ password_login: true, allow_guest: false, default_lang: 'tr' })
  })

  it('refuses a wrong password with the code the login screen understands', async () => {
    await expect(post('/api/login/password', { name: 'uye@x.com', password: 'yanlis' })).rejects.toMatchObject({ status: 401, code: 'bad-credentials' })
    await expect(post('/api/login/password', { name: 'isimsiz', password: 'x' })).rejects.toMatchObject({ status: 401 })
    await expect(firebaseApi('/api/me')).rejects.toMatchObject({ status: 401 })
  })

  it('signs in, knows who is admin, and signs out', async () => {
    const r = await post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
    expect(r.user).toEqual({ id: 'U1', name: 'uye', admin: false })
    expect((await firebaseApi('/api/me')).user.id).toBe('U1')
    await post('/api/logout', {})
    await expect(firebaseApi('/api/me')).rejects.toMatchObject({ status: 401 })
    const a = await post('/api/login/password', { name: 'mertcan.tasyurekk@gmail.com', password: 'a' })
    expect(a.user.admin).toBe(true)
  })

  it('never uses the tracker\'s localStorage keys', async () => {
    await post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
    expect([...st.m.keys()]).toEqual(['tt-og-auth'])
  })

  it('first read of a new member is empty, first write creates rev 1 in ogstate/ only', async () => {
    await post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
    expect(await firebaseApi('/api/data')).toEqual({ state: null, rev: 0 })
    const w = await put({ state: { workouts: [], routines: [{ id: 'r' }] }, baseRev: 0 })
    expect(w).toMatchObject({ ok: true, rev: 1 })
    expect([...fb.docs.keys()]).toEqual(['ogstate/U1'])
    const writes = fb.calls.filter(c => c.init.method === 'PATCH')
    expect(writes.every(c => c.url.includes('/ogstate/') && !c.url.includes('/userdata/'))).toBe(true)
    const d = await firebaseApi('/api/data')
    expect(d.rev).toBe(1)
    expect(d.state.routines).toEqual([{ id: 'r' }])
    expect((await firebaseApi('/api/data/rev')).rev).toBe(1)
  })

  it('applies the server rules: drops the active workout and non-entries, refuses empty state', async () => {
    await post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
    await put({ state: { workouts: [{ d: 1 }, null, 5], routines: [], active: { x: 1 } }, baseRev: 0 })
    const d = await firebaseApi('/api/data')
    expect(d.state.workouts).toEqual([{ d: 1 }])
    expect(d.state.active).toBeUndefined()
    await expect(put({ state: { _rev: 3 } })).rejects.toMatchObject({ status: 400 })
    await expect(put({ state: { workouts: 'x' } })).rejects.toMatchObject({ status: 400 })
  })

  it('answers a stale baseRev with 409 and the current document', async () => {
    await post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
    await put({ state: { workouts: [{ d: 1 }] }, baseRev: 0 })
    await put({ state: { workouts: [{ d: 2 }] }, baseRev: 1 })
    const e = await put({ state: { workouts: [{ d: 3 }] }, baseRev: 1 }).catch(x => x)
    expect(e.status).toBe(409)
    expect(e.data.rev).toBe(2)
    expect(e.data.state.workouts).toEqual([{ d: 2 }])
  })

  it('loses a race to another device without overwriting it (Firestore precondition)', async () => {
    await post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
    await put({ state: { workouts: [{ d: 1 }] }, baseRev: 0 })
    fb.setBeforeWrite((docs, path) => {
      docs.set(path, { fields: { state: { stringValue: JSON.stringify({ workouts: [{ d: 'other' }] }) }, rev: { integerValue: '2' } }, updateTime: fb.bump() })
    })
    const e = await put({ state: { workouts: [{ d: 'mine' }] }, baseRev: 1 }).catch(x => x)
    expect(e.status).toBe(409)
    expect(e.data.state.workouts).toEqual([{ d: 'other' }])
    expect(JSON.parse(fb.docs.get('ogstate/U1').fields.state.stringValue).workouts).toEqual([{ d: 'other' }])
  })

  it('keeps a newer reset stamp', async () => {
    await post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
    await put({ state: { workouts: [], resetAt: 50, resetIds: { a: 1 } }, baseRev: 0 })
    await put({ state: { workouts: [], resetAt: 10 }, baseRev: 1 })
    expect((await firebaseApi('/api/data')).state).toMatchObject({ resetAt: 50, resetIds: { a: 1 } })
  })

  it('refreshes an expired token, and a dead refresh token ends the session', async () => {
    await post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
    const a = JSON.parse(st.getItem('tt-og-auth')); a.exp = 0; st.setItem('tt-og-auth', JSON.stringify(a))
    await firebaseApi('/api/data')
    const last = fb.calls[fb.calls.length - 1]
    expect(last.init.headers.Authorization).toBe('Bearer tok2')
    const b = JSON.parse(st.getItem('tt-og-auth')); b.exp = 0; b.refreshToken = 'bozuk'; st.setItem('tt-og-auth', JSON.stringify(b))
    await expect(firebaseApi('/api/me')).rejects.toMatchObject({ status: 401 })
    expect(st.getItem('tt-og-auth')).toBeNull()
  })

  it('answers 404 for what this backend does not have', async () => {
    await expect(firebaseApi('/api/push/public-key')).rejects.toMatchObject({ status: 404 })
    await expect(firebaseApi('/api/admin/users')).rejects.toMatchObject({ status: 404 })
  })
})

describe('display name', () => {
  it('reads only displayName from userdata/, never writes there', async () => {
    const base = fb.fetch
    _setTestHooks({ fetch: async (url, init) => {
      if (url.includes('/userdata/')) { fb.calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ fields: { displayName: { stringValue: 'Seda' } } }) } }
      return base(url, init)
    } })
    const r = await post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
    expect(r.user.name).toBe('Seda')
    const ud = fb.calls.filter(c => c.url.includes('/userdata/'))
    expect(ud.length).toBe(1)
    expect(ud[0].url).toContain('mask.fieldPaths=displayName')
    expect(ud.every(c => !c.init.method || c.init.method === 'GET')).toBe(true)
    await firebaseApi('/api/me')
    expect(fb.calls.filter(c => c.url.includes('/userdata/')).length).toBe(1)   // cached
  })
})

describe('tracker payload', () => {
  it('reads only the payload field of userdata/, and never writes there', async () => {
    const base = fb.fetch
    _setTestHooks({ fetch: async (url, init) => {
      if (url.includes('/userdata/')) {
        fb.calls.push({ url, init })
        const f = url.includes('mask.fieldPaths=payload') ? { payload: { stringValue: '{"workouts":[]}' } } : { displayName: { stringValue: 'Seda' } }
        return { ok: true, status: 200, json: async () => ({ fields: f }) }
      }
      return base(url, init)
    } })
    await post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
    expect(await firebaseApi('/api/tracker')).toEqual({ payload: '{"workouts":[]}' })
    const ud = fb.calls.filter(c => c.url.includes('/userdata/'))
    expect(ud.every(c => !c.init.method || c.init.method === 'GET')).toBe(true)
    expect(ud.some(c => c.url.includes('/userdata/U1?mask.fieldPaths=payload'))).toBe(true)
  })
  it('answers null when the member has no tracker document', async () => {
    await post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
    expect(await firebaseApi('/api/tracker')).toEqual({ payload: null })
  })
})

describe('profile defaults', () => {
  it('fills a missing language with Turkish and moves an old profile to the brand gold once', async () => {
    await post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
    await put({ state: { workouts: [], accent: 'lime' }, baseRev: 0 })
    let d = (await firebaseApi('/api/data')).state
    expect(d).toMatchObject({ lang: 'tr', accent: 'brand', brandAccent: 1 })
    await put({ state: { workouts: [], accent: 'sky', lang: 'en', brandAccent: 1 }, baseRev: 1 })
    d = (await firebaseApi('/api/data')).state
    expect(d).toMatchObject({ lang: 'en', accent: 'sky' })   // a later choice is kept
  })
})
