// Timetable.jsx — attendance tracking with AI backend integration
import { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, LogOut, Save, Coffee, BarChart2, AlertTriangle, Upload, Sparkles, Loader2, CheckCircle2, RefreshCw } from 'lucide-react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import * as pdfjsLib from 'pdfjs-dist'
import {
  DAYS, SLOTS, LUNCH_SLOT, SUNDAY_SLOTS,
  getTimetable, saveTimetable, getSubjectStats,
  getStudentSubjectAttendance, fetchBackendStats,
  syncBackendAttendanceToStudent,
} from '../store'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || ''
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`
const PIE_COLORS = ['#0a1628', '#e2e8f0']

function SubjectPie({ subject, attended, total }) {
  const missed = total - attended
  const pct = total > 0 ? Math.round((attended / total) * 100) : 0
  const low = total > 0 && pct < 75
  const data = [{ name: 'Attended', value: attended || 0 }, { name: 'Missed', value: missed || 0 }]
  return (
    <div className={`bg-white rounded-2xl border-2 p-5 shadow-sm transition-all ${low ? 'border-red-400 shadow-red-100' : 'border-slate-200'}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-black text-[#0a1628] text-sm truncate max-w-[130px]">{subject}</span>
        <span className={`text-xs font-black px-2.5 py-1 rounded-full ${low ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'}`}>{pct}%</span>
      </div>
      <p className="text-slate-400 text-xs mb-3">{attended} of {total} classes attended</p>
      {total > 0 ? (
        <ResponsiveContainer width="100%" height={130}>
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={32} outerRadius={52} paddingAngle={3} dataKey="value">
              <Cell fill={PIE_COLORS[0]} /><Cell fill={PIE_COLORS[1]} />
            </Pie>
            <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 12 }} />
            <Legend iconSize={8} wrapperStyle={{ fontSize: 11, color: '#64748b' }} />
          </PieChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-[130px] flex items-center justify-center text-slate-300 text-xs">No attendance data yet</div>
      )}
      {low && (
        <div className="mt-3 flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 animate-pulse">
          <AlertTriangle size={14} className="text-red-500 shrink-0" />
          <span className="text-red-600 text-xs font-bold">⚠️ Warning: Low Attendance Detected</span>
        </div>
      )}
    </div>
  )
}

export default function Timetable({ userId, onBack, onLogout }) {
  const [timetable, setTimetable] = useState(() => getTimetable(userId))
  const [attData, setAttData]     = useState(() => getStudentSubjectAttendance(userId))
  const [saved, setSaved]         = useState(false)
  const [tab, setTab]             = useState('timetable')
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrMsg, setOcrMsg]       = useState('')
  const [ocrError, setOcrError]   = useState('')
  const [ocrSuccess, setOcrSuccess] = useState('')
  const [backendStats, setBackendStats] = useState(null)
  const ocrFileRef = useRef()

  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  const refresh = useCallback(() => {
    fetchBackendStats(userId).then(d => { if (d) setBackendStats(d) })
  }, [userId])

  const syncFromBackend = useCallback(async () => {
    setSyncing(true)
    setSyncMsg('Syncing attendance from backend...')
    await syncBackendAttendanceToStudent(userId)
    setAttData(getStudentSubjectAttendance(userId))
    setSyncing(false)
    setSyncMsg('✓ Attendance synced!')
    setTimeout(() => setSyncMsg(''), 3000)
  }, [userId])

  useEffect(() => {
    setTimetable(getTimetable(userId))
    refresh()
    syncFromBackend()   // pull backend attendance on load
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [userId, refresh, syncFromBackend])

  const handleChange = (day, slot, value) => { setTimetable(prev => ({ ...prev, [day]: { ...prev[day], [slot]: value } })); setSaved(false) }
  const handleSave = () => { saveTimetable(userId, timetable); setSaved(true); setTimeout(() => setSaved(false), 2000) }
  const handleClear = () => {
    const empty = {}
    DAYS.forEach(d => { empty[d] = {}; SLOTS.forEach(s => { empty[d][s] = '' }) })
    setTimetable(empty); saveTimetable(userId, empty)
  }

  const handleOcrUpload = async (file) => {
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['pdf','png','jpg','jpeg'].includes(ext)) { setOcrError('Please upload a PDF or PNG/JPG image.'); return }
    setOcrError(''); setOcrSuccess(''); setOcrLoading(true); setOcrMsg(`Reading ${ext.toUpperCase()}...`)

    try {
      // ── Prompt that extracts full day/time/subject mapping ──────────────────
      const structuredPrompt = `You are a timetable parser for an Indian engineering college (MNIT Jaipur).
Analyze this timetable and extract every class entry.

Return ONLY a valid JSON array — no markdown, no explanation — where each object has:
{
  "day": "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday",
  "time": one of ["8:00 AM","9:00 AM","10:00 AM","11:00 AM","12:00 PM","2:00 PM","3:00 PM","4:00 PM"],
  "subject": "subject or course name"
}

Rules:
- Skip lunch (1:00 PM) and free/empty slots
- If a subject appears multiple times on the same day, include each occurrence
- Normalize time to the nearest slot from the list above
- Return [] if nothing found`

      let entries = []

      if (ext === 'pdf') {
        const buf = await file.arrayBuffer()
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise
        let text = ''
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const content = await page.getTextContent()
          text += content.items.map(it => it.str).join(' ') + '\n'
        }
        setOcrMsg('AI is reading your timetable...')
        if (!GEMINI_API_KEY) throw new Error('Set VITE_GEMINI_API_KEY in your .env file to use AI extraction.')
        let res, attempt = 0
        while (attempt < 3) {
          res = await fetch(GEMINI_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: `${structuredPrompt}\n\nTimetable text:\n${text.slice(0, 10000)}` }] }],
              generationConfig: { temperature: 0.1 },
            }),
          })
          if (res.status !== 429) break
          attempt++
          setOcrMsg(`Rate limited — retrying in ${attempt * 5}s...`)
          await new Promise(r => setTimeout(r, attempt * 5000))
        }
        if (!res.ok) throw new Error(`Gemini API error ${res.status}`)
        const data = await res.json()
        const raw = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').replace(/```json|```/g, '').trim()
        entries = JSON.parse(raw)

      } else {
        // Image → Gemini Vision
        const dataUrl = await new Promise((res, rej) => {
          const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = rej; r.readAsDataURL(file)
        })
        setOcrMsg('AI is reading your timetable image...')
        if (!GEMINI_API_KEY) throw new Error('Set VITE_GEMINI_API_KEY in your .env file to use AI extraction.')
        const res = await fetch(GEMINI_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [
                { text: structuredPrompt },
                { inline_data: { mime_type: file.type || 'image/png', data: dataUrl.split(',')[1] } },
              ],
            }],
            generationConfig: { temperature: 0.1 },
          }),
        })
        if (!res.ok) throw new Error(`Gemini Vision error ${res.status}`)
        const data = await res.json()
        const raw = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').replace(/```json|```/g, '').trim()
        entries = JSON.parse(raw)
      }

      if (!Array.isArray(entries) || entries.length === 0) throw new Error('No timetable entries found in the file.')

      // ── Fill the timetable grid ─────────────────────────────────────────────
      const newTT = getTimetable(userId)
      let filled = 0

      entries.forEach(({ day, time, subject }) => {
        if (!day || !time || !subject) return
        // Normalise day capitalisation
        const normDay = DAYS.find(d => d.toLowerCase() === day.toLowerCase())
        // Normalise time — find closest slot
        const normSlot = SLOTS.find(s => s === time) ||
          SLOTS.find(s => s.replace(' ', '').toLowerCase() === time.replace(' ', '').toLowerCase())
        if (normDay && normSlot && normSlot !== LUNCH_SLOT) {
          newTT[normDay][normSlot] = subject
          filled++
        }
      })

      setTimetable(newTT)
      saveTimetable(userId, newTT)
      setOcrSuccess(`✅ ${filled} slots filled from ${entries.length} entries extracted!`)
      setTab('timetable')

    } catch (err) {
      setOcrError(`Failed: ${err.message}`)
    } finally {
      setOcrLoading(false)
      setOcrMsg('')
    }
  }

  const stats = getSubjectStats(userId, timetable)
  const subjects = Object.keys(stats)
  const hasLowAtt = subjects.some(s => stats[s].total > 0 && (stats[s].attended / stats[s].total) < 0.75)

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-[#0a1628] px-6 py-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-blue-300 hover:text-white transition mr-1"><ArrowLeft size={20} /></button>
          <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center"><span className="text-base">🎓</span></div>
          <div><span className="text-white font-black">My Attendance</span><span className="text-blue-300 text-xs ml-2">{userId}</span></div>
        </div>
        <div className="flex items-center gap-2">
          {hasLowAtt && <span className="hidden sm:flex items-center gap-1 text-xs text-red-300 font-bold animate-pulse"><AlertTriangle size={13} /> Low Attendance</span>}
          {backendStats && (
            <span className="hidden sm:flex items-center gap-2 bg-white/10 rounded-xl px-3 py-1.5 text-xs text-white font-bold">
              AI: {backendStats.attendance_percentage}% · {backendStats.attendance_status}
            </span>
          )}
          <button onClick={onLogout} className="text-blue-300 hover:text-white transition text-sm flex items-center gap-1"><LogOut size={15} /></button>
        </div>
      </nav>

      <div className="bg-white border-b border-slate-200 px-6">
        <div className="max-w-7xl mx-auto flex gap-0">
          {[{ key: 'timetable', label: 'Timetable' }, { key: 'analytics', label: '📊 Analytics' }, { key: 'upload', label: '✨ Upload Timetable' }].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-5 py-3.5 text-sm font-bold border-b-2 transition-colors ${tab === t.key ? 'border-[#0a1628] text-[#0a1628]' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
              {t.label}
            </button>
          ))}
          {tab === 'timetable' && (
            <div className="ml-auto flex items-center gap-2 py-2">
              <button onClick={handleSave} className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all ${saved ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-[#0a1628] text-white hover:bg-[#162444]'}`}>
                <Save size={14} />{saved ? 'Saved!' : 'Save'}
              </button>
              <button onClick={handleClear} className="text-xs text-slate-400 hover:text-red-500 transition px-2">Clear</button>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {tab === 'timetable' && (
          <>
            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-slate-500 mb-4 flex-wrap">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-100 border border-amber-300 inline-block" /> Lunch Break</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-purple-100 border border-purple-300 inline-block" /> Sunday Block (10 AM–12 PM)</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-slate-100 border border-slate-300 inline-block" /> Editable slot</span>
            </div>

            {/* ── Main weekly grid (Mon–Sat) ── */}
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm mb-5">
              <table className="w-full min-w-[900px] border-collapse">
                <thead>
                  <tr className="bg-[#0a1628]">
                    <th className="p-3 text-left text-xs text-blue-200 uppercase tracking-wider font-bold w-28">Days / Time</th>
                    {SLOTS.map((slot, i) => {
                      const endTimes = ['8:55','9:55','10:55','11:55','12:55','1:55','2:55','3:55','4:55']
                      return (
                        <th key={slot} className={`p-2 text-center text-xs font-bold ${slot === LUNCH_SLOT ? 'text-amber-300' : 'text-blue-200'}`}>
                          <div>{slot.replace(' AM','').replace(' PM','')}</div>
                          <div className="text-[10px] opacity-60">–{endTimes[i]}</div>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {DAYS.filter(d => d !== 'Sunday').map(day => (
                    <tr key={day} className="border-b border-slate-100 hover:bg-slate-50/40 transition-colors">
                      <td className="p-3 font-black text-[#0a1628] text-sm whitespace-nowrap bg-slate-50 border-r border-slate-200">
                        {day}
                      </td>
                      {SLOTS.map(slot => {
                        const isLunch = slot === LUNCH_SLOT
                        const val = timetable[day]?.[slot] || ''
                        return (
                          <td key={slot} className={`p-1.5 align-middle border-r border-slate-100 last:border-0 ${isLunch ? 'bg-amber-50' : ''}`}>
                            {isLunch ? (
                              <div className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-amber-100 border border-amber-200 text-amber-700 text-[10px] font-bold">
                                <Coffee size={11} /> Lunch
                              </div>
                            ) : (
                              <input
                                type="text"
                                value={val}
                                onChange={e => handleChange(day, slot, e.target.value)}
                                placeholder="—"
                                className="w-full bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-[#0a1628] rounded-lg px-2 py-1.5 text-xs text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-[#0a1628]/10 transition-all text-center"
                              />
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Sunday block (10 AM – 12 PM) ── */}
            <div className="bg-white rounded-2xl border border-purple-200 shadow-sm overflow-hidden">
              <div className="bg-purple-700 px-5 py-3 flex items-center justify-between">
                <div>
                  <span className="text-white font-black text-sm">Sunday</span>
                  <span className="text-purple-200 text-xs ml-3">Special Block · 10:00 AM – 12:00 PM</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 p-4">
                {SUNDAY_SLOTS.map(slot => (
                  <div key={slot}>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">
                      {slot} – {slot === '10:00 AM' ? '10:55 AM' : '11:55 AM'}
                    </label>
                    <input
                      type="text"
                      value={timetable['Sunday']?.[slot] || ''}
                      onChange={e => handleChange('Sunday', slot, e.target.value)}
                      placeholder="Subject / Activity..."
                      className="w-full bg-slate-50 border border-slate-200 hover:border-purple-400 focus:border-purple-600 rounded-xl px-3 py-2.5 text-sm text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-purple-500/10 transition-all"
                    />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === 'analytics' && (
          <>
            {hasLowAtt && (
              <div className="mb-6 flex items-center gap-3 bg-red-50 border-2 border-red-300 rounded-2xl px-5 py-4 animate-pulse">
                <AlertTriangle size={22} className="text-red-500 shrink-0" />
                <div><p className="text-red-600 font-black text-sm">⚠️ Warning: Low Attendance Detected</p><p className="text-red-500 text-xs mt-0.5">One or more subjects are below 75%.</p></div>
              </div>
            )}
            {subjects.length === 0 ? (
              <div className="text-center py-20 text-slate-400"><BarChart2 size={44} className="mx-auto mb-3 opacity-30" /><p className="font-medium">No subjects yet. Fill in your timetable first.</p></div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {subjects.map(subject => <SubjectPie key={subject} subject={subject} attended={stats[subject].attended} total={stats[subject].total} />)}
              </div>
            )}
          </>
        )}

        {tab === 'upload' && (
          <div className="max-w-lg mx-auto space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-[#0a1628] flex items-center justify-center mx-auto mb-5">
                <Sparkles size={28} className="text-white" />
              </div>
              <h2 className="text-xl font-black text-[#0a1628] mb-2">Upload Your Timetable</h2>
              <p className="text-slate-500 text-sm mb-2">
                Upload a photo or PDF of your timetable. Gemini AI will extract the full
                <b className="text-slate-700"> day → time → subject</b> mapping and fill the correct cells.
              </p>
              <p className="text-xs text-slate-400 mb-6">
                Supports: handwritten, printed, or scanned timetables · PNG, JPG, PDF
              </p>

              {!GEMINI_API_KEY && (
                <div className="mb-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-left">
                  <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-amber-700 text-xs">
                    <b>Gemini API key not set.</b> Add <code className="bg-amber-100 px-1 rounded">VITE_GEMINI_API_KEY=your_key</code> to your <code className="bg-amber-100 px-1 rounded">.env</code> file and restart the dev server.
                    Get a free key at <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" className="underline">aistudio.google.com</a>.
                  </p>
                </div>
              )}

              {ocrLoading ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <Loader2 size={36} className="text-[#0a1628] animate-spin" />
                  <p className="text-slate-600 font-semibold text-sm">{ocrMsg}</p>
                </div>
              ) : (
                <>
                  <button onClick={() => ocrFileRef.current?.click()}
                    className="w-full border-2 border-dashed border-[#0a1628] rounded-2xl py-10 flex flex-col items-center gap-3 hover:bg-slate-50 transition cursor-pointer">
                    <Upload size={32} className="text-[#0a1628]" />
                    <span className="font-bold text-[#0a1628]">Click to upload or drag & drop</span>
                    <span className="text-slate-400 text-xs">PNG, JPG or PDF · Max 10MB</span>
                  </button>
                  {ocrError && (
                    <div className="mt-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-left">
                      <AlertTriangle size={15} className="text-red-500 shrink-0 mt-0.5" />
                      <p className="text-red-600 text-sm font-medium">{ocrError}</p>
                    </div>
                  )}
                  {ocrSuccess && (
                    <div className="mt-4 flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                      <CheckCircle2 size={15} className="text-green-600 shrink-0" />
                      <p className="text-green-700 text-sm font-medium">{ocrSuccess}</p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* How it works */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">How it works</p>
              <div className="space-y-2">
                {[
                  ['📸', 'Upload a photo or PDF of your printed/handwritten timetable'],
                  ['🤖', 'Gemini AI reads the image and extracts day, time slot, and subject name for every cell'],
                  ['📅', 'Each subject is placed in the exact correct day + time slot in your timetable'],
                  ['✏️', 'You can edit any cell manually after extraction'],
                ].map(([icon, text]) => (
                  <div key={text} className="flex items-start gap-3 text-sm text-slate-600">
                    <span className="text-base shrink-0">{icon}</span>
                    <span>{text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      <input ref={ocrFileRef} type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden"
        onChange={e => { handleOcrUpload(e.target.files[0]); e.target.value = '' }} />
    </div>
  )
}
