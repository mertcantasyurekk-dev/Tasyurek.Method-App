// Taşyürek Method: editing a supplement list (groups of { name, dose }) — a member's, from the coach
// panel, or the coach's own (S.mySupplements). The caller decides where it is saved.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { cleanSupplements } from '../lib/firebase-api.js'
import Icon from './Icon.jsx'
import { Button, TextField } from './ui.jsx'

const newId = p => p + Math.random().toString(36).slice(2, 8)

export default function SupplementsEditor({ initial, onSave, onCancel, busy }) {
  const [list, setList] = useState(() => JSON.parse(JSON.stringify(initial?.length ? initial : [{ id: newId('g'), label: 'Sabah', items: [] }])))
  const setG = (gi, f) => setList(l => l.map((g, i) => (i === gi ? f(g) : g)))
  return <div>
    {list.map((g, gi) => <div key={g.id} className="card" style={{ marginBottom: 10 }}>
      <TextField value={g.label} onChange={e => setG(gi, x => ({ ...x, label: e.target.value }))} placeholder="Grup (ör. Sabah — kahvaltıyla)" maxLength={80} />
      {g.items.map((it, ii) => <div key={it.id} className="row" style={{ gap: 6, marginTop: 8 }}>
        <TextField value={it.name} onChange={e => setG(gi, x => ({ ...x, items: x.items.map((y, j) => (j === ii ? { ...y, name: e.target.value } : y)) }))} placeholder="Ad" maxLength={80} style={{ flex: 2 }} />
        <TextField value={it.dose} onChange={e => setG(gi, x => ({ ...x, items: x.items.map((y, j) => (j === ii ? { ...y, dose: e.target.value } : y)) }))} placeholder="Doz" maxLength={120} style={{ flex: 2 }} />
        <button className="iconbtn" aria-label="Sil" onClick={() => setG(gi, x => ({ ...x, items: x.items.filter((_, j) => j !== ii) }))}><Icon name="trash" /></button>
      </div>)}
      <div style={{ height: 8 }} />
      <Button size="sm" variant="ghost" icon="plus" onClick={() => setG(gi, x => ({ ...x, items: [...x.items, { id: newId('i'), name: '', dose: '' }] }))}>Takviye ekle</Button>
    </div>)}
    <Button size="sm" variant="ghost" icon="plus" onClick={() => setList(l => [...l, { id: newId('g'), label: '', items: [] }])}>Grup ekle</Button>
    <div className="small dim" style={{ margin: '8px 2px 12px' }}>Boş satırlar kaydedilmez. Grubu silmek için içindeki her şeyi sil.</div>
    <Button variant="primary" icon="checkCircle" disabled={busy} onClick={() => onSave(cleanSupplements(list))}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={onCancel}>Vazgeç</Button>
  </div>
}

// The coach's own list, for their own training.
function MySupplements({ close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  return <>
    <h3>Takviyelerim</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>Kendi antrenmanın için. Ana sayfanda her gün işaretlersin. Üyelerin listelerini Koç panelinden kurarsın.</div>
    <SupplementsEditor initial={S.mySupplements} onCancel={close}
      onSave={list => { update(s => { s.mySupplements = list }); close(); useUI.getState().toast(list.length ? 'Takviyelerin kaydedildi' : 'Takviye listen boşaltıldı') }} />
  </>
}
export const mySupplementsSheet = () => useUI.getState().openSheet(close => <MySupplements close={close} />)
