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
    if (u.pathname.endsWith('/documents:runQuery')) {
      const q = JSON.parse(init.body).structuredQuery
      const coll = q.from[0].collectionId
      return res(200, [...docs.entries()].filter(([k]) => k.startsWith(coll + '/') && !k.slice(coll.length + 1).includes('/'))
        .map(([k, d]) => ({ document: { name: 'projects/p/databases/default/documents/' + k, fields: d.fields, updateTime: d.updateTime } })).concat([{ readTime: 'x' }]))
    }
    const path = decodeURIComponent(u.pathname.split('/documents/')[1])
    const cur = docs.get(path)
    if ((init.method || 'GET') === 'GET' && !path.includes('/')) {
      const documents = [...docs.entries()].filter(([k]) => k.startsWith(path + '/'))
        .map(([k, d]) => ({ name: 'projects/p/databases/default/documents/' + k, fields: d.fields, updateTime: d.updateTime }))
      return res(200, { documents })
    }
    if ((init.method || 'GET') === 'GET') return cur ? res(200, { fields: cur.fields, updateTime: cur.updateTime }) : res(404, {})
    if (init.method === 'DELETE') { docs.delete(path); return res(200, {}) }
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
        const f = url.includes('mask.fieldPaths=payload') ? { payload: { stringValue: '{"workouts":[]}' }, workoutTimers: { mapValue: { fields: { '2026-09-01': { mapValue: { fields: { totalSec: { integerValue: '3600' } } } } } } } } : { displayName: { stringValue: 'Seda' } }
        return { ok: true, status: 200, json: async () => ({ fields: f }) }
      }
      return base(url, init)
    } })
    await post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
    expect(await firebaseApi('/api/tracker')).toEqual({ payload: '{"workouts":[]}', workoutTimers: { '2026-09-01': { totalSec: 3600 } }, mealLog: null })
    const ud = fb.calls.filter(c => c.url.includes('/userdata/'))
    expect(ud.every(c => !c.init.method || c.init.method === 'GET')).toBe(true)
    expect(ud.some(c => c.url.includes('/userdata/U1?mask.fieldPaths=payload&mask.fieldPaths=workoutTimers&mask.fieldPaths=mealLog'))).toBe(true)
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

  it('lists members (not the coach) from their summaries; an old document is summarised once', async () => {
    const str = v => ({ stringValue: v })
    fb.docs.set('userdata/U1', { fields: { displayName: str('Seda'), email: str('uye@x.com') }, updateTime: 'x' })
    fb.docs.set('userdata/U2', { fields: { displayName: str('Ali'), email: str('iki@x.com') }, updateTime: 'x' })
    fb.docs.set('userdata/ADM', { fields: { displayName: str('Mertcan'), email: str('mertcan.tasyurekk@gmail.com') }, updateTime: 'x' })
    const today = new Date(); const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    // an old document without a summary
    fb.docs.set('ogstate/U1', { fields: { state: str(JSON.stringify({ workouts: [{ d: '2026-01-01' }, { d: iso }], bodyweight: [{ d: iso, w: 78.5 }] })), rev: { integerValue: '4' } }, updateTime: 'y' })
    await asCoach()
    await putPlan('U2', PLAN)
    const { members } = await firebaseApi('/api/coach/members')
    expect(members.map(m => m.name)).toEqual(['Ali', 'Seda'])
    const seda = members.find(m => m.uid === 'U1')
    expect(seda).toMatchObject({ joined: true, planAt: null })
    expect(seda.summary).toMatchObject({ lastWorkout: iso, lastWeight: 78.5 })
    const ali = members.find(m => m.uid === 'U2')
    expect(ali).toMatchObject({ joined: false, summary: null })
    expect(ali.planAt).toBeTruthy()
    const one = await firebaseApi('/api/coach/member?uid=U1')
    expect(one.state.workouts).toHaveLength(2)
    expect(one.info).toEqual({ name: 'Seda', email: 'uye@x.com' })
    expect(one.plan).toBeNull()
  })
  it('a member\'s save writes the summary next to the state', async () => {
    await post('/api/logout', {})
    await post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
    await put({ state: { workouts: [{ d: '2026-09-28', entries: [] }], bodyweight: [{ d: '2026-09-28', w: 61 }] }, baseRev: 0 })
    const sum = JSON.parse(fb.docs.get('ogstate/U1').fields.summary.stringValue)
    expect(sum).toMatchObject({ v: 1, lastWorkout: '2026-09-28', lastWeight: 61 })
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
    const payload = { targets: { protein: 150, carbs: 200, fat: 55, water: 3, sleep: 7.5 }, customMacroTargets: { trainingDay: { protein: 180, carbs: 250, fat: 60 }, offDay: { protein: 180, carbs: 150, fat: 70 } }, customWeeklyTargets: { workoutsPerWeek: 4, cardioSessionsPerWeek: 3, cardioMinutesPerWeek: 120 } }
    fb.docs.set('userdata/U1', { fields: { payload: { stringValue: JSON.stringify(payload) } }, updateTime: 'x' })
    await asCoach()
    const one = await firebaseApi('/api/coach/member?uid=U1')
    expect(one.trackerTargets).toEqual({ training: { p: 180, c: 250, f: 60 }, rest: { p: 180, c: 150, f: 70 }, water: 3, sleep: 7.5, workoutsPerWeek: 4, cardioSessionsPerWeek: 3, cardioMinutesPerWeek: 120 })
    expect(one.targets).toBeNull()
  })
})

describe('the weekly seal on the way to Firestore', () => {
  it('stores past weeks as day totals only; this week keeps its meals', async () => {
    await post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
    const today = new Date(); const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const old = new Date(today); old.setDate(old.getDate() - 14)
    const nutrition = {
      [iso(old)]: { items: [{ id: 'a', n: 'Köfte', p: 30, c: 5, f: 20, t: 1 }, { id: 'b', n: 'Pilav', p: 4, c: 40, f: 5, t: 2 }], _ts: 2 },
      [iso(today)]: { items: [{ id: 'c', n: 'Yulaf', p: 10, c: 60, f: 6, t: 3 }], _ts: 3 }
    }
    await put({ state: { workouts: [], nutrition }, baseRev: 0 })
    const stored = fb.docs.get('ogstate/U1').fields.state.stringValue
    expect(stored).not.toMatch(/Köfte|Pilav/)
    expect(stored).toMatch(/Yulaf/)
    const back = (await firebaseApi('/api/data')).state.nutrition
    expect(back[iso(old)]).toMatchObject({ p: 34, c: 45, f: 25 })
    expect(back[iso(old)].items).toBeUndefined()
  })
})

describe('shared foods', () => {
  const str = v => ({ stringValue: v })
  it('reads the tracker\'s list, adds in the same shape, never twice by name', async () => {
    fb.docs.set('sharedData/customFoods', { fields: { items: { arrayValue: { values: [
      { mapValue: { fields: { id: str('x1'), name: str('Yemekhane mercimek'), unit: str('portion'), portionLabel: str('1 kase'), kcal: { integerValue: '150' }, protein: { integerValue: '9' }, carbs: { doubleValue: 20.5 }, fat: { integerValue: '4' } } } }
    ] } } }, updateTime: 'f0' })
    await post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
    const { foods } = await firebaseApi('/api/foods')
    expect(foods).toEqual([{ id: 'x1', name: 'Yemekhane mercimek', unit: 'portion', portionLabel: '1 kase', kcal: 150, protein: 9, carbs: 20.5, fat: 4 }])
    const add = f => firebaseApi('/api/foods', { method: 'POST', body: JSON.stringify({ food: f }) })
    const r = await add({ name: 'Protein bar X', unit: '100g', protein: '32', carbs: 40, fat: '12,5' })
    expect(r.food).toMatchObject({ name: 'Protein bar X', unit: '100g', protein: 32, carbs: 40, fat: 12.5, kcal: 401 })
    expect((await add({ name: 'yemekhane MERCİMEK', protein: 1, carbs: 1, fat: 1 })).existed).toBe(true)
    expect((await firebaseApi('/api/foods')).foods.map(f => f.name)).toEqual(['Yemekhane mercimek', 'Protein bar X'])
    await expect(add({ name: '', protein: 1, carbs: 1, fat: 1 })).rejects.toMatchObject({ status: 400 })
    await expect(add({ name: 'Boş', protein: 0, carbs: 0, fat: 0 })).rejects.toMatchObject({ status: 400 })
  })
  it('retries when someone else added a food at the same moment', async () => {
    await post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
    fb.docs.set('sharedData/customFoods', { fields: { items: { arrayValue: { values: [] } } }, updateTime: 'f0' })
    fb.setBeforeWrite((docs, path) => {
      docs.set(path, { fields: { items: { arrayValue: { values: [{ mapValue: { fields: { name: str('Başkası'), unit: str('100g'), protein: { integerValue: '1' }, carbs: { integerValue: '1' }, fat: { integerValue: '1' } } } }] } } }, updateTime: fb.bump() })
    })
    await firebaseApi('/api/foods', { method: 'POST', body: JSON.stringify({ food: { name: 'Benim', protein: 5, carbs: 5, fat: 5 } }) })
    expect((await firebaseApi('/api/foods')).foods.map(f => f.name)).toEqual(['Başkası', 'Benim'])
  })
})

describe('coach notes, reviews, tracker extras', () => {
  const asCoach = () => post('/api/login/password', { name: 'mertcan.tasyurekk@gmail.com', password: 'a' })
  const asMember = () => post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
  const PUT = (p, b) => firebaseApi(p, { method: 'PUT', body: JSON.stringify(b) })

  it('notes are the coach\'s alone; reports pile up', async () => {
    await asCoach()
    expect(await firebaseApi('/api/coach/notes?uid=U1')).toEqual({ note: '', goal: '', reports: [] })
    await PUT('/api/coach/notes', { uid: 'U1', note: 'Sol diz: squat yok', goal: 'Cut' })
    await PUT('/api/coach/notes', { uid: 'U1', addReport: { week: '2026-09-27', text: 'rapor 1', message: 'm1', macro: { training: { p: 180, c: 240, f: 60 } } } })
    await PUT('/api/coach/notes', { uid: 'U1', goal: 'Bakım' })
    const n = await firebaseApi('/api/coach/notes?uid=U1')
    expect(n).toMatchObject({ note: 'Sol diz: squat yok', goal: 'Bakım' })
    expect(n.reports).toHaveLength(1)
    expect(n.reports[0]).toMatchObject({ week: '2026-09-27', text: 'rapor 1' })
    expect([...fb.docs.keys()]).toContain('coachnotes/U1')
    await post('/api/logout', {}); await asMember()
    await expect(firebaseApi('/api/coach/notes?uid=U1')).rejects.toMatchObject({ status: 403 })
    const d = await firebaseApi('/api/data')
    expect(JSON.stringify(d.state || {})).not.toMatch(/squat|rapor 1/)
  })

  it('a weekly message reaches the member\'s open app, and can be taken back', async () => {
    await asCoach()
    const r1 = await PUT('/api/coach/review', { uid: 'U1', text: 'Harika hafta!', week: '2026-09-27' })
    const r2 = await PUT('/api/coach/review', { uid: 'U1', text: 'İkinci mesaj' })
    expect(new Set(r2.reviews.map(x => x.id)).size).toBe(2)   // unique ids, even in the same millisecond
    await expect(PUT('/api/coach/review', { uid: 'U1', text: '  ' })).rejects.toMatchObject({ status: 400 })
    const old = await PUT('/api/coach/review', { uid: 'U1', text: 'tracker\'dan eski', sentAt: '2026-09-01T09:00:00Z' })
    expect(old.reviews[0]).toMatchObject({ text: 'tracker\'dan eski', sentAt: '2026-09-01T09:00:00.000Z', imported: true })   // keeps its date, sorts first, marked
    expect(old.reviews[1].imported).toBeUndefined()
    await PUT('/api/coach/review', { uid: 'U1', remove: old.reviews[0].id })
    await post('/api/logout', {}); await asMember()
    const d = await firebaseApi('/api/data')
    expect(d.state.coachReviews.map(x => x.text)).toEqual(['Harika hafta!', 'İkinci mesaj'])
    expect(d.rev).toBe(4000000)   // four writes to the plan document: two sent, one old brought in and taken back
    await expect(PUT('/api/coach/review', { uid: 'U1', text: 'kendime mesaj' })).rejects.toMatchObject({ status: 403 })
    await post('/api/logout', {}); await asCoach()
    await PUT('/api/coach/review', { uid: 'U1', remove: r1.reviews[0].id })
    await post('/api/logout', {}); await asMember()
    expect((await firebaseApi('/api/data')).state.coachReviews.map(x => x.text)).toEqual(['İkinci mesaj'])
  })

  it('brings the tracker\'s note, goal, reports and messages', async () => {
    const str = v => ({ stringValue: v })
    const map = o => ({ mapValue: { fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, str(v)])) } })
    fb.docs.set('userdata/U1', { fields: {
      coachNote: str('FMF, kolşisin'), coachGoal: str('Recomposition'),
      coachReports: { arrayValue: { values: [map({ week: '2026-09-20', text: 'eski rapor', message: 'eski mesaj' })] } },
      weeklyRevisions: { arrayValue: { values: [map({ text: 'eski değerlendirme', sentAt: '2026-09-21T10:00:00Z' })] } }
    }, updateTime: 'u' })
    await asCoach()
    const x = await firebaseApi('/api/coach/tracker-extra?uid=U1')
    expect(x.note).toBe('FMF, kolşisin')
    expect(x.goal).toBe('Recomposition')
    expect(x.reports[0]).toMatchObject({ week: '2026-09-20', text: 'eski rapor' })
    expect(x.reviews[0]).toMatchObject({ text: 'eski değerlendirme', sentAt: '2026-09-21T10:00:00Z' })
    expect(fb.calls.filter(c => c.url.includes('/userdata/')).every(c => !c.init.method || c.init.method === 'GET')).toBe(true)
  })
})

describe('member list when a rule is missing', () => {
  it('opens anyway and names the collection it could not read', async () => {
    fb.docs.set('userdata/U1', { fields: { displayName: { stringValue: 'Seda' }, email: { stringValue: 'uye@x.com' } }, updateTime: 'x' })
    const base = fb.fetch
    _setTestHooks({ fetch: async (url, init) => {
      if (url.endsWith(':runQuery') && JSON.parse(init.body).structuredQuery.from[0].collectionId === 'coachplan') return { ok: false, status: 403, json: async () => [{ error: { message: 'Missing or insufficient permissions.' } }] }
      return base(url, init)
    } })
    await post('/api/login/password', { name: 'mertcan.tasyurekk@gmail.com', password: 'a' })
    const r = await firebaseApi('/api/coach/members')
    expect(r.members.map(m => m.name)).toEqual(['Seda'])
    expect(r.warnings).toEqual(['coachplan listelenemedi: Missing or insufficient permissions.'])
  })
  it('the members themselves not readable: a clear error', async () => {
    const base = fb.fetch
    _setTestHooks({ fetch: async (url, init) => {
      if (url.endsWith(':runQuery') && JSON.parse(init.body).structuredQuery.from[0].collectionId === 'userdata') return { ok: false, status: 403, json: async () => [{ error: { message: 'Missing or insufficient permissions.' } }] }
      return base(url, init)
    } })
    await post('/api/login/password', { name: 'mertcan.tasyurekk@gmail.com', password: 'a' })
    await expect(firebaseApi('/api/coach/members')).rejects.toMatchObject({ status: 403, message: 'userdata listelenemedi: Missing or insufficient permissions.' })
  })
})

describe('backups', () => {
  const str = v => ({ stringValue: v })
  const asCoach = () => post('/api/login/password', { name: 'mertcan.tasyurekk@gmail.com', password: 'a' })
  const seed = (big = false) => {
    fb.docs.set('userdata/U1', { fields: { displayName: str('Seda'), email: str('uye@x.com'), payload: str(big ? 'x'.repeat(500 * 1024) : '{}') }, updateTime: 'a' })
    fb.docs.set('userdata/U2', { fields: { displayName: str('Ali'), email: str('iki@x.com'), payload: str(big ? 'y'.repeat(500 * 1024) : '{}') }, updateTime: 'a' })
    fb.docs.set('ogstate/U1', { fields: { state: str('{"workouts":[{"d":"2026-09-01"}]}'), rev: { integerValue: '3' } }, updateTime: 'b' })
    fb.docs.set('coachplan/U1', { fields: { plan: str('{"routines":[]}'), rev: { integerValue: '1' } }, updateTime: 'c' })
    fb.docs.set('coachnotes/U1', { fields: { note: str('FMF') }, updateTime: 'd' })
    fb.docs.set('sharedData/customFoods', { fields: { items: { arrayValue: { values: [] } } }, updateTime: 'e' })
    fb.docs.set('backups/backup_2026-09-19', { fields: { note: str('the tracker\'s own') }, updateTime: 'f' })
  }
  const day = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

  it('takes everything, once every two days, and it reads back whole', async () => {
    seed(); await asCoach()
    const r1 = await post('/api/coach/backup', {})
    expect(r1).toMatchObject({ skipped: false, id: 'og_' + day(), parts: 0 })
    const saved = JSON.parse(fb.docs.get('backups/og_' + day()).fields.data.stringValue)
    expect(Object.keys(saved.collections).sort()).toEqual(['coachnotes', 'coachplan', 'ogstate', 'sharedData', 'userdata'])
    expect(saved.collections.ogstate.U1.state.stringValue).toContain('2026-09-01')
    expect(saved.collections.coachnotes.U1.note.stringValue).toBe('FMF')
    expect(saved.collections.userdata.U2.displayName.stringValue).toBe('Ali')
    expect((await post('/api/coach/backup', {})).skipped).toBe(true)          // same day: not again
    expect((await post('/api/coach/backup', { force: true })).skipped).toBe(false)
    const list = await firebaseApi('/api/coach/backups')
    expect(list.meta.lastDay).toBe(day())
    expect(list.backups.map(b => b.id)).toEqual(['og_' + day()])            // the tracker's backup is not listed
  })

  it('splits a big copy per member, with nothing lost', async () => {
    seed(true); await asCoach()
    const r = await post('/api/coach/backup', { force: true })
    expect(r.parts).toBe(2)
    const main = fb.docs.get('backups/og_' + day())
    expect(main.fields.split.booleanValue).toBe(true)
    const partIds = main.fields.parts.arrayValue.values.map(v => v.stringValue).sort()
    expect(partIds).toEqual([`og_${day()}__U1`, `og_${day()}__U2`])
    const p1 = JSON.parse(fb.docs.get('backups/' + partIds[0]).fields.data.stringValue)
    expect(p1.collections.userdata.U1.payload.stringValue.length).toBe(500 * 1024)
    expect(p1.collections.coachnotes.U1.note.stringValue).toBe('FMF')
    expect(JSON.parse(main.fields.data.stringValue).collections.sharedData).toBeTruthy()
  })

  it('keeps the last 15 copies of this app and never the tracker\'s', async () => {
    seed(); await asCoach()
    for (let i = 1; i <= 17; i++) fb.docs.set(`backups/og_2025-01-${String(i).padStart(2, '0')}`, { fields: { kind: str('og') }, updateTime: 'z' })
    fb.docs.set('backups/og_2025-01-01__U1', { fields: { kind: str('og-part') }, updateTime: 'z' })
    await post('/api/coach/backup', { force: true })
    const og = [...fb.docs.keys()].filter(k => /^backups\/og_\d/.test(k) && !k.includes('__'))
    expect(og).toHaveLength(15)
    expect(fb.docs.has('backups/og_2025-01-01')).toBe(false)
    expect(fb.docs.has('backups/og_2025-01-01__U1')).toBe(false)             // its parts go with it
    expect(fb.docs.has('backups/og_2025-01-03')).toBe(false)
    expect(fb.docs.has('backups/og_2025-01-04')).toBe(true)
    expect(fb.docs.has('backups/backup_2026-09-19')).toBe(true)
  })

  it('is the coach\'s alone', async () => {
    seed(); await post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
    await expect(post('/api/coach/backup', { force: true })).rejects.toMatchObject({ status: 403 })
    await expect(firebaseApi('/api/coach/backup/data')).rejects.toMatchObject({ status: 403 })
  })
})

describe('tracker payload for the coach', () => {
  it('reads a member\'s payload, never writes', async () => {
    fb.docs.set('userdata/U1', { fields: { payload: { stringValue: '{"programs":[]}' } }, updateTime: 'a' })
    await post('/api/login/password', { name: 'mertcan.tasyurekk@gmail.com', password: 'a' })
    expect(await firebaseApi('/api/coach/tracker-payload?uid=U1')).toEqual({ payload: '{"programs":[]}', workoutTimers: null, mealLog: null })
    expect(await firebaseApi('/api/coach/tracker-payload?uid=NOPE')).toEqual({ payload: null })
  })
})

describe('weekly targets and supplements', () => {
  const asCoach = () => post('/api/login/password', { name: 'mertcan.tasyurekk@gmail.com', password: 'a' })
  const PUT = (p, b) => firebaseApi(p, { method: 'PUT', body: JSON.stringify(b) })
  it('weekly targets alone are enough; the member sees them', async () => {
    await asCoach()
    const r = await PUT('/api/coach/targets', { uid: 'U1', targets: { workoutsPerWeek: '4', cardioMinutesPerWeek: 120.4 } })
    expect(r.targets).toMatchObject({ workoutsPerWeek: 4, cardioMinutesPerWeek: 120, cardioSessionsPerWeek: null, training: null })
    await expect(PUT('/api/coach/targets', { uid: 'U1', targets: {} })).rejects.toMatchObject({ status: 400 })
    await post('/api/logout', {}); await post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
    expect((await firebaseApi('/api/data')).state.coachTargets.workoutsPerWeek).toBe(4)
  })
  it('the coach sets a supplement list, cleaned; the member reads it; the tracker\'s comes over', async () => {
    await asCoach()
    const list = [{ id: 'morning', label: 'Sabah', items: [{ id: 'd3', name: 'D3 + K2', dose: '5000 IU' }, { id: 'x', name: '' }] }, { label: 'Boş', items: [] }]
    const r = await PUT('/api/coach/supplements', { uid: 'U1', supplements: list })
    expect(r.supplements).toEqual([{ id: 'morning', label: 'Sabah', items: [{ id: 'd3', name: 'D3 + K2', dose: '5000 IU' }] }])
    await post('/api/logout', {}); await post('/api/login/password', { name: 'uye@x.com', password: 'dogru' })
    expect((await firebaseApi('/api/data')).state.coachSupplements[0].items[0].name).toBe('D3 + K2')
    await expect(PUT('/api/coach/supplements', { uid: 'U1', supplements: [] })).rejects.toMatchObject({ status: 403 })
    const str = v => ({ stringValue: v })
    fb.docs.set('userdata/U2', { fields: { customSupplements: { arrayValue: { values: [{ mapValue: { fields: { id: str('ev'), label: str('Akşam'), items: { arrayValue: { values: [{ mapValue: { fields: { id: str('mg'), name: str('Magnezyum'), dose: str('400 mg') } } }] } } } } }] } } }, updateTime: 'u' })
    await post('/api/logout', {}); await asCoach()
    expect((await firebaseApi('/api/coach/tracker-extra?uid=U2')).supplements).toEqual([{ id: 'ev', label: 'Akşam', items: [{ id: 'mg', name: 'Magnezyum', dose: '400 mg' }] }])
  })
})
