// @vitest-environment happy-dom
// Taşyürek: in the Firebase build there is no weigh-in before a workout; the session carries the
// latest weigh-in of the last seven days, and Home asks for the morning one until it is in.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { todayISO, isoOf } from './lib/format.js'

vi.mock('./lib/morning-weigh.js', async orig => ({ ...(await orig()), MORNING_WEIGH: true }))
vi.mock('react-router-dom', async orig => ({ ...(await orig()), useNavigate: () => vi.fn() }))

const { startFlow } = await import('./sheets.jsx')
const { default: Home } = await import('./views/Home.jsx')
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return isoOf(d) }

describe('morning weigh-in', () => {
  let host, root
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [] })
    useStore.setState(s => ({ S: { ...s.S, active: null, routines: [], workouts: [], dayPlan: {}, week: {}, bodyweight: [], weighIn: true }, user: null }))
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  })
  afterEach(() => { act(() => root.unmount()); host.remove() })

  it('Start opens no weigh-in and stamps the latest weight of the week', () => {
    useStore.setState(s => ({ S: { ...s.S, bodyweight: [{ d: daysAgo(9), w: 81, t: 1 }, { d: daysAgo(2), w: 80.2, t: 2 }] } }))
    act(() => startFlow([]))
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(useStore.getState().S.active.bw).toBe(80.2)
  })
  it('with nothing in the last seven days the session has no body weight', () => {
    useStore.setState(s => ({ S: { ...s.S, bodyweight: [{ d: daysAgo(8), w: 81, t: 1 }] } }))
    act(() => startFlow([]))
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(useStore.getState().S.active.bw).toBeNull()
  })
  it('Home asks until today is weighed, even with the card switched off', () => {
    useStore.setState(s => ({ S: { ...s.S, showWeightCard: false, bodyweight: [{ d: daysAgo(1), w: 80, t: 1 }] } }))
    act(() => root.render(<Home />))
    expect(host.textContent).toContain('Bugün henüz tartılmadın')
    act(() => useStore.setState(s => ({ S: { ...s.S, bodyweight: [...s.S.bodyweight, { d: todayISO(), w: 79.8, t: 2 }] } })))
    expect(host.textContent).not.toContain('Bugün henüz tartılmadın')
    expect(host.textContent).toContain('79.8')
  })
})
