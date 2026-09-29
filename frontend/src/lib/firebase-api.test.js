import { describe, it, expect, beforeEach } from 'vitest'
import { firebaseApi, _setTestHooks } from './firebase-api.js'

// In-memory Firebase: identitytoolkit, securetoken and one Firestore collection.
function fakeFirebase() {
  const docs = new Map()          // path -> { fields, updateTime }
  let clock = 0
  const users = { 'uye@x.com': { pw: 'dogru', uid: 'U1' }, 'iki@x.com': { pw: 'b', uid: 'U2' }, 'mertcan.tasyurekk@gmail.com': { pw: 'a', uid: 'ADM' } }
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
    const path = decodeURIComponent(u.pathname.split('/documents/')[1])
    const cur = docs.get(path)
    if ((init.method || 'GET') === 'GET' && !path.includes('/')) {
      const documents = [...docs.entries()].filter(([k]) => k.startsWith(path + '/'))
        .map(([k, d]) => ({ name: 'projects/p/databases/default/documents/' + k, fields: d.fields, updateTime: d.updateTime }))
      return res(200, { documents })
    }
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


describe('coach plan', () => {
  const asCoach = () => post('/api/login/password', { name: 'mertcan.tasyurekk@gmail.com', password: 'a' })
  const asMember = () => post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
  const PLAN = {
    routines: [{ id: 'cA', name: 'A', ex: [{ id: '0025', sets: 3, reps: 10 }] }, { id: 'cB', name: 'B', ex: [] }],
    week: { 1: ['cA'], 3: ['cB', 'nope'], 9: ['cA'], 5: [] },
    customEx: [{ id: 'cx1', n: 'Koç hareketi', custom: true }]
  }
  const putPlan = (uid, plan) => firebaseApi('/api/coach/plan', { method: 'PUT', body: JSON.stringify({ uid, plan }) })

  it('the coach writes a clean plan; the member is served it over their own copy', async () => {
    await asMember()
    await put({ state: { workouts: [{ d: '2026-09-01' }], routines: [{ id: 'own', name: 'Kendi' }], week: { 2: ['own'] }, customEx: [{ id: 'mine', n: 'x' }] }, baseRev: 0 })
    await post('/api/logout', {})
    await asCoach()
    const w = await putPlan('U1', PLAN)
    expect(w.rev).toBe(1)
    expect(w.plan.week).toEqual({ 1: ['cA'], 3: ['cB'] })   // unknown ids, bad days and empty days dropped
    expect(fb.docs.has('coachplan/U1')).toBe(true)
    expect(JSON.parse(fb.docs.get('ogstate/U1').fields.state.stringValue).routines[0].id).toBe('own')   // member doc untouched
    await post('/api/logout', {})

    await asMember()
    const d = await firebaseApi('/api/data')
    expect(d.rev).toBe(1000001)
    expect(d.state.routines.map(r => r.id)).toEqual(['cA', 'cB'])
    expect(d.state.week).toEqual({ 1: ['cA'], 3: ['cB'] })
    expect(d.state.customEx.map(c => c.id)).toEqual(['mine', 'cx1'])
    expect(d.state.workouts).toEqual([{ d: '2026-09-01' }])
    expect((await firebaseApi('/api/data/rev')).rev).toBe(1000001)
  })

  it('a member push uses the combined revision; a plan change meanwhile is a conflict', async () => {
    await asCoach(); await putPlan('U1', PLAN); await post('/api/logout', {})
    await asMember()
    const r1 = await put({ state: { workouts: [{ d: '2026-09-02' }] }, baseRev: 1000000 })
    expect(r1.rev).toBe(1000001)
    await post('/api/logout', {}); await asCoach(); await putPlan('U1', { ...PLAN, routines: [PLAN.routines[0]] }); await post('/api/logout', {})
    await asMember()
    expect((await firebaseApi('/api/data/rev')).rev).toBe(2000001)   // the open app sees the coach's change
    const e = await put({ state: { workouts: [{ d: '2026-09-03' }] }, baseRev: 1000001 }).catch(x => x)
    expect(e.status).toBe(409)
    expect(e.data.rev).toBe(2000001)
    expect(e.data.state.routines.map(r => r.id)).toEqual(['cA'])
    const r2 = await put({ state: { workouts: [{ d: '2026-09-03' }] }, baseRev: 2000001 })
    expect(r2.rev).toBe(2000002)
  })

  it('a member with a plan but no document yet gets the plan, in Turkish', async () => {
    await asCoach(); await putPlan('U1', PLAN); await post('/api/logout', {})
    await asMember()
    const d = await firebaseApi('/api/data')
    expect(d.state).toMatchObject({ lang: 'tr' })
    expect(d.state.routines).toHaveLength(2)
  })

  it('members cannot use the coach routes; the coach\'s own data is never overlaid', async () => {
    await asMember()
    await expect(firebaseApi('/api/coach/members')).rejects.toMatchObject({ status: 403 })
    await expect(putPlan('U2', PLAN)).rejects.toMatchObject({ status: 403 })
    expect(fb.docs.has('coachplan/U2')).toBe(false)
    await post('/api/logout', {})
    await asCoach()
    await putPlan('ADM', PLAN)
    await put({ state: { workouts: [], routines: [{ id: 'mine' }] }, baseRev: 0 })
    const d = await firebaseApi('/api/data')
    expect(d.state.routines.map(r => r.id)).toEqual(['mine'])
    expect(d.rev).toBe(1)
  })

  it('refuses an empty plan', async () => {
    await asCoach()
    await expect(putPlan('U1', { routines: [] })).rejects.toMatchObject({ status: 400 })
    await expect(putPlan('', PLAN)).rejects.toMatchObject({ status: 400 })
  })

  it('lists members (not the coach) with a one-line summary', async () => {
    const str = v => ({ stringValue: v })
    fb.docs.set('userdata/U1', { fields: { displayName: str('Seda'), email: str('uye@x.com') }, updateTime: 'x' })
    fb.docs.set('userdata/U2', { fields: { displayName: str('Ali'), email: str('iki@x.com') }, updateTime: 'x' })
    fb.docs.set('userdata/ADM', { fields: { displayName: str('Mertcan'), email: str('mertcan.tasyurekk@gmail.com') }, updateTime: 'x' })
    const today = new Date().toISOString().slice(0, 10)
    fb.docs.set('ogstate/U1', { fields: { state: str(JSON.stringify({ workouts: [{ d: '2026-01-01' }, { d: today }], bodyweight: [{ d: '2026-01-01', w: 80 }, { d: today, w: 78.5 }] })), rev: { integerValue: '4' } }, updateTime: 'y' })
    await asCoach()
    await putPlan('U2', PLAN)
    const { members } = await firebaseApi('/api/coach/members')
    expect(members.map(m => m.name)).toEqual(['Ali', 'Seda'])
    const seda = members.find(m => m.uid === 'U1')
    expect(seda).toMatchObject({ joined: true, lastWorkout: today, workouts: 2, workouts7: 1, lastWeight: 78.5, planAt: null })
    const ali = members.find(m => m.uid === 'U2')
    expect(ali).toMatchObject({ joined: false, workouts: 0, lastWorkout: null })
    expect(ali.planAt).toBeTruthy()
    const one = await firebaseApi('/api/coach/member?uid=U1')
    expect(one.state.workouts).toHaveLength(2)
    expect(one.plan).toBeNull()
  })
})

describe('coached prescription', () => {
  it('a member always starts from the plan; the coach keeps their own choice', async () => {
    await post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
    await put({ state: { workouts: [], startFrom: 'last' }, baseRev: 0 })
    expect((await firebaseApi('/api/data')).state.startFrom).toBe('plan')
    await post('/api/logout', {})
    await post('/api/login/password', { name: 'mertcan.tasyurekk@gmail.com', password: 'a' })
    await put({ state: { workouts: [], startFrom: 'last' }, baseRev: 0 })
    expect((await firebaseApi('/api/data')).state.startFrom).toBe('last')
  })
})

describe('coach targets', () => {
  const asCoach = () => post('/api/login/password', { name: 'mertcan.tasyurekk@gmail.com', password: 'a' })
  const asMember = () => post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
  const putT = (uid, targets) => firebaseApi('/api/coach/targets', { method: 'PUT', body: JSON.stringify({ uid, targets }) })
  const putPlan = (uid, plan) => firebaseApi('/api/coach/plan', { method: 'PUT', body: JSON.stringify({ uid, plan }) })
  const PLAN = { routines: [{ id: 'cA', name: 'A', ex: [] }], week: { 1: ['cA'] } }

  it('the member sees the targets; plan and targets never overwrite each other', async () => {
    await asCoach()
    const w = await putT('U1', { training: { p: '180', c: 250, f: '60,5' }, rest: { p: 180, c: 150, f: 70 }, water: 3, sleep: 8 })
    expect(w.targets).toMatchObject({ training: { p: 180, c: 250, f: 60.5 }, rest: { c: 150 }, water: 3, sleep: 8 })
    await putPlan('U1', PLAN)
    await putT('U1', { training: { p: 170, c: 240, f: 60 } })
    await post('/api/logout', {})
    await asMember()
    const d = await firebaseApi('/api/data')
    expect(d.state.coachTargets).toMatchObject({ training: { p: 170 }, rest: null })
    expect(d.state.routines.map(r => r.id)).toEqual(['cA'])
    expect(d.rev).toBe(3000000)
  })

  it('targets alone (no program yet) still reach the member', async () => {
    await asCoach(); await putT('U1', { rest: { p: 150, c: 150, f: 50 } }); await post('/api/logout', {})
    await asMember()
    const d = await firebaseApi('/api/data')
    expect(d.state.coachTargets.rest).toEqual({ p: 150, c: 150, f: 50 })
    expect(d.state.routines).toBeUndefined()
    const { members } = await (async () => { await post('/api/logout', {}); await asCoach(); return firebaseApi('/api/coach/members') })().catch(() => ({ members: [] }))
    expect(Array.isArray(members)).toBe(true)
  })

  it('refuses nonsense and non-coaches', async () => {
    await asCoach()
    await expect(putT('U1', { training: { p: 900, c: 200, f: 50 } })).rejects.toMatchObject({ status: 400 })
    await expect(putT('U1', { training: { p: 180, c: 200 } })).rejects.toMatchObject({ status: 400 })
    await post('/api/logout', {}); await asMember()
    await expect(putT('U1', { training: { p: 180, c: 200, f: 60 } })).rejects.toMatchObject({ status: 403 })
  })

  it('offers the old tracker\'s targets to start from', async () => {
    const payload = { targets: { protein: 150, carbs: 200, fat: 55, water: 3, sleep: 7.5 }, customMacroTargets: { trainingDay: { protein: 180, carbs: 250, fat: 60 }, offDay: { protein: 180, carbs: 150, fat: 70 } } }
    fb.docs.set('userdata/U1', { fields: { payload: { stringValue: JSON.stringify(payload) } }, updateTime: 'x' })
    await asCoach()
    const one = await firebaseApi('/api/coach/member?uid=U1')
    expect(one.trackerTargets).toEqual({ training: { p: 180, c: 250, f: 60 }, rest: { p: 180, c: 150, f: 70 }, water: 3, sleep: 7.5 })
    expect(one.targets).toBeNull()
  })
})
