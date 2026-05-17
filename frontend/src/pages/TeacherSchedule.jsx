// TeacherSchedule.jsx — persistent class schedule with AI PDF scan
import { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, Save, Loader2, Sparkles, AlertCircle, CheckCircle2, X } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import { getTeacherSchedule, saveTeacherSchedule } from '../store'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || ''
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`
const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const EMPTY_ROW = () => ({ day: 'Monday', time: '', subject: '', section: '', room: '' })

function Toast({ msg, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t) }, [onClose])
  const colors = { success: 'bg-green-600', info: 'bg-[#002147]', error: 'bg-red-600' }
  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-5 py-3 rounded-2xl text-white text-sm font-bold shadow-2xl ${colors[type] || colors.info} animate-slide-up`}>
      {type === 'success' && <CheckCircle2 size={16} />}
      {type === 'error' && <AlertCircle size={16} />}
      {msg}
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100"><X size={14} /></button>
    </div>
  )
}

function ScheduleRow({ row, index, onChange, onRemove }) {
  const inp = 'w-full border border-slate-200 focus:border-[#002147] rounded-lg px-2 py-1.5 text-sm text-slate-800 focus:outline-none transition bg-white'
  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors group">
      <td className="px-2 py-2 text-center text-xs text-slate-400 font-mono w-8">{index + 1}</td>
      <td className="px-2 py-2">
        <select value={row.day} onChange={e => onChange(index, 'day', e.target.value)} className={inp}>
          {DAYS.map(d => <option key={d}>{d}</option>)}
        </select>
      </td>
      <td className="px-2 py-2"><input type="text" value={row.time} onChange={e => onChange(index, 'time', e.target.value)} placeholder="9:00 AM" className={inp} /></td>
      <td className="px-2 py-2"><input type="text" value={row.subject} onChange={e => onChange(index, 'subject', e.target.value)} placeholder="Subject" className={inp} /></td>
      <td className="px-2 py-2"><input type="text" value={row.section} onChange={e => onChange(index, 'section', e.target.value)} placeholder="A" className={`${inp} w-16`} /></td>
      <td className="px-2 py-2"><input type="text" value={row.room} onChange={e => onChange(index, 'room', e.target.value)} placeholder="LT-3" className={`${inp} w-20`} /></td>
      <td className="px-2 py-2 w-8">
        <button onClick={() => onRemove(index)} className="text-slate-300 hover:text-red-500 transition opacity-0 group-hover:opacity-100"><Trash2 size={14} /></button>
      </td>
    </tr>
  )
}

export default function TeacherSchedule({ teacherId }) {
  const [rows, setRows] = useState([])
  const [saveInd, setSaveInd] = useState('')
  const [scanning, setScanning] = useState(false)
  const [toast, setToast] = useState(null)
  const fileRef = useRef()
  const saveTimer = useRef()

  useEffect(() => {
    const saved = getTeacherSchedule(teacherId)
    setRows(saved.length > 0 ? saved : [EMPTY_ROW()])
    if (saved.length > 0) setToast({ msg: 'Schedule loaded.', type: 'info' })
  }, [teacherId])

  useEffect(() => {
    setSaveInd('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTeacherSchedule(teacherId, rows)
      setSaveInd('saved')
      setTimeout(() => setSaveInd(''), 2500)
    }, 700)
    return () => clearTimeout(saveTimer.current)
  }, [rows, teacherId])

  const handleChange = (i, field, val) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  const handleAdd = () => setRows(prev => [...prev, EMPTY_ROW()])
  const handleRemove = (i) => { if (rows.length === 1) { setRows([EMPTY_ROW()]); return }; setRows(prev => prev.filter((_, idx) => idx !== i)) }

  const handleScanFile = async (file) => {
    if (!file) return
    setScanning(true)
    try {
      const buf = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise
      let text = ''
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const content = await page.getTextContent()
        text += content.items.map(it => it.str).join(' ') + '\n'
      }
      const prompt = `Extract all class schedule entries. Return ONLY a JSON array with objects: { "day", "time", "subject", "section", "room" }. Text:\n${text.slice(0, 8000)}`
      const res = await fetch(GEMINI_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1 } }) })
      const data = await res.json()
      const parsed = JSON.parse((data.candidates?.[0]?.content?.parts?.[0]?.text || '').replace(/```json|```/g, '').trim())
      setRows(parsed.length > 0 ? parsed : [EMPTY_ROW()])
      setToast({ msg: `Extracted ${parsed.length} entries.`, type: 'success' })
    } catch (err) {
      setToast({ msg: `Scan failed: ${err.message}`, type: 'error' })
    } finally { setScanning(false) }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 -mt-8 pb-12">
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <h2 className="font-black text-[#002147]">My Schedule</h2>
            {saveInd === 'saving' && <span className="text-xs text-slate-400 flex items-center gap-1"><span className="w-3 h-3 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />Saving...</span>}
            {saveInd === 'saved' && <span className="text-xs text-green-600 flex items-center gap-1 font-semibold"><Save size={11} />Saved</span>}
          </div>
          <button onClick={() => fileRef.current?.click()} disabled={scanning}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold border-2 border-[#002147] text-[#002147] hover:bg-[#002147] hover:text-white transition disabled:opacity-50">
            {scanning ? <><Loader2 size={13} className="animate-spin" />Scanning...</> : <><Sparkles size={13} />Scan PDF</>}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="bg-[#002147]">
                {['#','Day','Time','Subject','Section','Room',''].map(h => (
                  <th key={h} className="px-2 py-2.5 text-xs font-bold text-blue-200 uppercase tracking-wider text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => <ScheduleRow key={i} row={row} index={i} onChange={handleChange} onRemove={handleRemove} />)}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-slate-100">
          <button onClick={handleAdd} className="flex items-center gap-1.5 text-sm text-[#002147] font-bold hover:underline">
            <Plus size={15} /> Add Row
          </button>
        </div>
      </div>
      <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={e => { handleScanFile(e.target.files[0]); e.target.value = '' }} />
    </div>
  )
}
