/**
 * SectionAttendance.jsx
 * Attendance tab: teacher registers students (Roll No + Name + Photo).
 * Status is set automatically by the Live Camera session — no manual toggle.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Plus, Trash2, Send, CheckCircle2, FolderOpen,
  ChevronRight, AlertCircle, Camera, Upload, Loader2,
  ArrowLeft, Activity, Clock, Users,
} from 'lucide-react'
import { API } from '../store'

const EMPTY_ROW = () => ({
  studentRollNo: '',
  studentName:   '',
  photoDataUrl:  null,
  embeddingOk:   false,
  // status is NOT set here — it comes from the live session
})

function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = e => res(e.target.result)
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

// ─── Photo cell ───────────────────────────────────────────────────────────────
function PhotoCell({ row, index, onChange }) {
  const inputRef = useRef()
  const [extracting, setExtracting] = useState(false)

  const handleFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return
    const dataUrl = await fileToDataUrl(file)
    onChange(index, 'photoDataUrl', dataUrl)

    if (row.studentRollNo.trim()) {
      setExtracting(true)
      try {
        const res = await fetch(`${API}/register-embedding`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roll_no:        row.studentRollNo.trim(),
            photo_data_url: dataUrl,
            student_name:   row.studentName.trim() || null,
          }),
        })
        if (res.ok) onChange(index, 'embeddingOk', true)
      } catch { /* stored on submit */ }
      finally { setExtracting(false) }
    }
  }

  return (
    <div onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }}
         onDragOver={e => e.preventDefault()} className="flex items-center gap-2">
      <div className="w-10 h-10 rounded-full border-2 border-dashed border-slate-300 overflow-hidden flex items-center justify-center bg-slate-50 shrink-0 hover:border-[#0a1628] transition-colors cursor-pointer"
           onClick={() => inputRef.current?.click()}>
        {row.photoDataUrl
          ? <img src={row.photoDataUrl} alt="" className="w-full h-full object-cover" />
          : extracting
            ? <Loader2 size={13} className="text-indigo-400 animate-spin" />
            : <Camera size={13} className="text-slate-300" />}
      </div>
      <button type="button" onClick={() => inputRef.current?.click()}
        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border-2 transition-all whitespace-nowrap
          ${row.embeddingOk
            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
            : row.photoDataUrl
              ? 'border-green-300 bg-green-50 text-green-700'
              : 'border-slate-200 text-slate-500 hover:border-[#0a1628] hover:text-[#0a1628]'}`}>
        {extracting
          ? <><Loader2 size={11} className="animate-spin" /> Saving...</>
          : row.embeddingOk
            ? <><CheckCircle2 size={11} /> Ready</>
            : <><Upload size={11} /> {row.photoDataUrl ? 'Change' : 'Photo'}</>}
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={e => handleFile(e.target.files[0])} />
    </div>
  )
}

// ─── Roster row — no attendance toggle ───────────────────────────────────────
function RosterRow({ row, index, onChange, onRemove, liveStatus }) {
  const statusStyle = {
    present:    { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: '✓ Present' },
    absent:     { bg: 'bg-red-50',     text: 'text-red-600',     border: 'border-red-200',     label: '✗ Absent'  },
    suspicious: { bg: 'bg-amber-50',   text: 'text-amber-600',   border: 'border-amber-200',   label: '⚠ Suspicious' },
  }
  const s = statusStyle[liveStatus] || null

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors group">
      <td className="px-3 py-3 text-center text-xs text-slate-400 font-mono w-10 align-middle">{index + 1}</td>
      <td className="px-3 py-3 align-middle">
        <input value={row.studentRollNo} onChange={e => onChange(index, 'studentRollNo', e.target.value)}
          placeholder="Roll No (e.g. 2022UCS1234)"
          className="w-full bg-white border border-slate-200 focus:border-[#0a1628] rounded-xl px-3 py-2 text-sm text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0a1628]/10 transition" />
      </td>
      <td className="px-3 py-3 align-middle">
        <input value={row.studentName} onChange={e => onChange(index, 'studentName', e.target.value)}
          placeholder="Name (optional)"
          className="w-full bg-white border border-slate-200 focus:border-[#0a1628] rounded-xl px-3 py-2 text-sm text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0a1628]/10 transition" />
      </td>
      <td className="px-3 py-3 align-middle">
        <PhotoCell row={row} index={index} onChange={onChange} />
      </td>
      {/* Status — set by live session, read-only here */}
      <td className="px-3 py-3 align-middle">
        {s ? (
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${s.bg} ${s.text} ${s.border}`}>
            {s.label}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-400 border border-slate-200">
            <Clock size={10} /> Pending
          </span>
        )}
      </td>
      <td className="px-2 py-3 w-10 align-middle">
        <button type="button" onClick={() => onRemove(index)}
          className="text-slate-300 hover:text-red-500 transition opacity-0 group-hover:opacity-100">
          <Trash2 size={15} />
        </button>
      </td>
    </tr>
  )
}

// ─── Section Manager ──────────────────────────────────────────────────────────
export function SectionManager({ teacherId, onOpen }) {
  const [sections, setSections] = useState([])
  const [newName, setNewName]   = useState('')
  const [subject, setSubject]   = useState('')
  const [loading, setLoading]   = useState(false)   // never block on load
  const [error, setError]       = useState('')

  const fetchSections = useCallback(async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)  // 3s timeout
    try {
      const res = await fetch(`${API}/sections/${teacherId}`, { signal: controller.signal })
      if (res.ok) setSections(await res.json())
      else setError('Backend returned an error.')
    } catch (e) {
      if (e.name === 'AbortError') {
        setError('Backend not reachable. Start the FastAPI server on port 8000.')
      }
      // else: other network error — show empty state, not spinner
    } finally {
      clearTimeout(timer)
      setLoading(false)
    }
  }, [teacherId])

  useEffect(() => { fetchSections() }, [fetchSections])

  const handleAdd = async (e) => {
    e.preventDefault(); setError('')
    if (!newName.trim()) { setError('Section name is required.'); return }
    try {
      const res = await fetch(`${API}/sections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), teacher_id: teacherId, subject: subject.trim() || null }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.detail || 'Failed'); return }
      setNewName(''); setSubject(''); fetchSections()
    } catch { setError('Could not connect to backend.') }
  }

  const handleDelete = async (id, name) => {
    if (!confirm(`Delete Section "${name}" and all its records?`)) return
    await fetch(`${API}/sections/${id}`, { method: 'DELETE' })
    fetchSections()
  }

  // Backend offline — show form anyway so teacher can still see the UI
  const isOffline = !!error && sections.length === 0

  return (
    <div className="max-w-3xl mx-auto px-4 -mt-8 pb-12">

      {/* Offline banner */}
      {isOffline && (
        <div className="mb-5 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
          <AlertCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-amber-800 font-bold text-sm">Backend not running</p>
            <p className="text-amber-700 text-xs mt-0.5">
              Start the FastAPI server: <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono">cd backend &amp;&amp; uvicorn main:app --reload</code>
            </p>
          </div>
          <button onClick={fetchSections} className="ml-auto text-xs text-amber-600 hover:text-amber-800 font-semibold whitespace-nowrap">
            Retry
          </button>
        </div>
      )}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-6 mb-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-[#0a1628] flex items-center justify-center">
            <FolderOpen size={18} className="text-white" />
          </div>
          <div>
            <h2 className="font-black text-[#0a1628]">Section Management</h2>
            <p className="text-slate-500 text-xs">Register students here — attendance is marked automatically via Live Camera</p>
          </div>
        </div>
        <form onSubmit={handleAdd} className="flex gap-3 flex-wrap">
          <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="Section name (e.g. CSE-3A)" className="input-field flex-1 min-w-[140px]" />
          <input type="text" value={subject} onChange={e => setSubject(e.target.value)}
            placeholder="Subject (optional)" className="input-field flex-1 min-w-[140px]" />
          <button type="submit" className="btn-navy flex items-center gap-2 whitespace-nowrap">
            <Plus size={16} /> Add Section
          </button>
        </form>
        {error && <p className="text-red-500 text-xs mt-2 flex items-center gap-1"><AlertCircle size={12} /> {error}</p>}
      </div>

      {sections.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <FolderOpen size={44} className="mx-auto mb-3 opacity-30" />
          <p className="font-bold text-lg">No sections yet</p>
          <p className="text-sm mt-1">Add your first section above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {sections.map(s => (
            <div key={s.id} className="bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md transition-all overflow-hidden group">
              <button onClick={() => onOpen(s)} className="w-full p-5 text-left flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-[#0a1628] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                    <span className="text-white font-black text-lg">{s.name[0].toUpperCase()}</span>
                  </div>
                  <div>
                    <p className="font-black text-[#0a1628] text-lg">{s.name}</p>
                    {s.subject && <p className="text-xs text-slate-500 mt-0.5">{s.subject}</p>}
                    <p className="text-xs text-slate-400 mt-0.5">
                      {new Date(s.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-300 group-hover:text-[#0a1628] transition-colors" />
              </button>
              <div className="border-t border-slate-100 px-5 py-2 flex justify-end">
                <button onClick={() => handleDelete(s.id, s.name)}
                  className="text-xs text-slate-400 hover:text-red-500 transition flex items-center gap-1">
                  <Trash2 size={11} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Section Roster — register students, view live-session results ────────────
export function SectionMatrix({ teacherId, section, onBack }) {
  const [rows, setRows]             = useState([EMPTY_ROW()])
  const [submitting, setSubmitting] = useState(false)
  const [saved, setSaved]           = useState(false)
  const [history, setHistory]       = useState([])   // past session records
  const [historyLoading, setHistoryLoading] = useState(false)
  // liveStatus: { [rollNo]: 'present' | 'absent' | 'suspicious' }
  // populated by the Live Camera tab via the shared section_id
  const [liveStatus, setLiveStatus] = useState({})

  // Load past records + poll for live session updates every 3s
  const loadHistory = useCallback(async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    try {
      const res = await fetch(`${API}/attendance/manual/${section.id}`, { signal: controller.signal })
      if (res.ok) {
        const data = await res.json()
        setHistory(data)
        const latest = {}
        data.forEach(r => {
          if (!latest[r.student_roll_no]) latest[r.student_roll_no] = r.status
        })
        setLiveStatus(latest)
      }
    } catch { }
    finally {
      clearTimeout(timer)
      setHistoryLoading(false)
    }
  }, [section.id])

  useEffect(() => {
    loadHistory()
    const id = setInterval(loadHistory, 3000)   // poll every 3s for live updates
    return () => clearInterval(id)
  }, [loadHistory])

  const handleChange = (i, field, value) =>
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r))
  const handleAddRow = () => setRows(prev => [...prev, EMPTY_ROW()])
  const handleRemove = (i) => {
    if (rows.length === 1) { setRows([EMPTY_ROW()]); return }
    setRows(prev => prev.filter((_, idx) => idx !== i))
  }

  // Save roster (register embeddings) — does NOT set attendance status
  const handleSaveRoster = async () => {
    const valid = rows.filter(r => r.studentRollNo.trim())
    if (valid.length === 0) return
    setSubmitting(true)
    try {
      // Register each student's embedding so live matching works
      await Promise.all(valid.map(r =>
        r.photoDataUrl
          ? fetch(`${API}/register-embedding`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                roll_no:        r.studentRollNo.trim(),
                photo_data_url: r.photoDataUrl,
                student_name:   r.studentName.trim() || null,
              }),
            })
          : Promise.resolve()
      ))
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      alert('Failed to save — check backend connection.')
    } finally { setSubmitting(false) }
  }

  const presentCount    = Object.values(liveStatus).filter(s => s === 'present').length
  const absentCount     = Object.values(liveStatus).filter(s => s === 'absent').length
  const suspiciousCount = Object.values(liveStatus).filter(s => s === 'suspicious').length

  return (
    <div className="max-w-4xl mx-auto px-4 -mt-8 pb-12 space-y-5">

      {/* Info banner */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-2xl px-5 py-4 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center shrink-0 mt-0.5">
          <Camera size={15} className="text-white" />
        </div>
        <div>
          <p className="text-indigo-800 font-bold text-sm">Attendance is marked automatically</p>
          <p className="text-indigo-600 text-xs mt-0.5">
            Register students below (Roll No + Photo), then go to <b>Live Camera</b> and select this section.
            The system will match faces using Euclidean distance and update status here in real time.
          </p>
        </div>
      </div>

      {/* Live summary strip */}
      {Object.keys(liveStatus).length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
            <p className="text-2xl font-black text-emerald-700">{presentCount}</p>
            <p className="text-xs text-emerald-600 font-semibold">Present</p>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
            <p className="text-2xl font-black text-red-600">{absentCount}</p>
            <p className="text-xs text-red-500 font-semibold">Absent</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
            <p className="text-2xl font-black text-amber-600">{suspiciousCount}</p>
            <p className="text-xs text-amber-500 font-semibold">Suspicious</p>
          </div>
        </div>
      )}

      {/* Roster table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-[#0a1628] flex items-center justify-center text-white font-black text-sm">
              {section.name[0].toUpperCase()}
            </span>
            <div>
              <h2 className="font-black text-[#0a1628]">{section.name}</h2>
              {section.subject && <p className="text-xs text-slate-400">{section.subject}</p>}
            </div>
            <span className="ml-2 text-xs text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full font-semibold">
              Student Roster
            </span>
          </div>
          <div className="flex items-center gap-2">
            {saved && (
              <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                <CheckCircle2 size={12} /> Saved!
              </span>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2.5 text-xs font-bold text-slate-400 uppercase tracking-wider text-center w-10">#</th>
                <th className="px-3 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wider text-left">Roll No</th>
                <th className="px-3 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wider text-left">Name</th>
                <th className="px-3 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wider text-left">Photo</th>
                <th className="px-3 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wider text-left">
                  Status <span className="text-slate-400 font-normal normal-case">(auto)</span>
                </th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <RosterRow
                  key={i}
                  row={row}
                  index={i}
                  onChange={handleChange}
                  onRemove={handleRemove}
                  liveStatus={liveStatus[row.studentRollNo.trim()] || null}
                />
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-slate-100 flex-wrap gap-3">
          <button onClick={handleAddRow}
            className="flex items-center gap-1.5 text-sm text-[#0a1628] font-bold hover:underline">
            <Plus size={15} /> Add Student
          </button>
          <button onClick={handleSaveRoster} disabled={submitting}
            className="btn-navy flex items-center gap-2 disabled:opacity-50">
            {submitting
              ? <><Loader2 size={16} className="animate-spin" /> Saving...</>
              : <><Send size={16} /> Save Roster & Register Faces</>}
          </button>
        </div>
      </div>

      {/* Session history */}
      {!historyLoading && history.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
            <Activity size={15} className="text-indigo-500" />
            <span className="text-sm font-bold text-slate-700">Session History</span>
            <span className="text-xs text-slate-400 ml-1">({history.length} records)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-xs text-slate-400 uppercase tracking-wider">
                  <th className="text-left px-4 py-2.5">Roll No</th>
                  <th className="text-left px-4 py-2.5">Name</th>
                  <th className="text-left px-4 py-2.5">Photo</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                  <th className="text-left px-4 py-2.5">Time</th>
                </tr>
              </thead>
              <tbody>
                {history.map(r => (
                  <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{r.student_roll_no}</td>
                    <td className="px-4 py-2.5 text-slate-600 text-xs">{r.student_name || '—'}</td>
                    <td className="px-4 py-2.5">
                      {r.has_photo
                        ? <span className="text-xs text-emerald-600 font-semibold">✓</span>
                        : <span className="text-xs text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold
                        ${r.status === 'present' ? 'bg-green-100 text-green-700'
                          : r.status === 'suspicious' ? 'bg-amber-100 text-amber-700'
                          : 'bg-red-100 text-red-600'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-400">
                      {new Date(r.submitted_at).toLocaleString('en-IN', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
