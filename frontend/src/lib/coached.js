// Taşyürek Method: a coached member trains the coach's program and nothing else — no routines of
// their own, no freestyle sessions, no adding, swapping, removing or reordering exercises or sets.
// They log what the program asks for. The coach (admin) keeps the full app.
import { useStore } from '../store/useStore.js'
import { FIREBASE } from './firebase-api.js'

export const isCoached = user => FIREBASE && !!user && !user.admin
export const coachedNow = () => isCoached(useStore.getState?.()?.user)
export const useCoached = () => useStore(s => isCoached(s.user))
