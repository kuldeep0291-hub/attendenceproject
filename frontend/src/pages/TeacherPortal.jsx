/**
 * TeacherPortal.jsx
 * Tabs: Live Camera (AI detection) | Attendance (section matrix → MongoDB) | My Schedule
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import * as faceapi from '@vladmandic/face-api'
import {
  LogOut, CheckCircle2, XCircle, BookOpen, Camera, ArrowLeft,
  Users, AlertCircle, CalendarDays, Eye, EyeOff, Activity,
  Loader2, Download, MapPin,
} from 'lucide-react'
import { API } from '../store'
import TeacherSchedule from './TeacherSchedule'
import { SectionManager, SectionMatrix } from './SectionAttendance'
import { sendViaGmail, buildAbsenceEmail } from '../services/gmailSender'
import { googleAccessToken } from './AuthPage'

const MODEL_URL = '/models'

// ─── Adaptive grid (mirrors backend) ─────────────────────────────────────────
function selectGrid(n) {
  if (n <= 2)  return { rows: 1, cols: 2 }
  if (n <= 12) return { rows: 2, cols: 2 }
  return { rows: 3, cols: 3 }
}
function assignQuadrant(cx, cy, vw, vh, rows, cols) {
  const col = Math.min(Math.floor(cx / (vw / cols)), cols - 1)
  const row = Math.min(Math.floor(cy / (vh / rows)), rows - 1)
  if (rows === 1 && cols === 2) return col === 0 ? 'L' : 'R'
  if (rows === 2 && cols === 2) return [['Q2','Q1'],['Q3','Q4']][row][col]
  return `Z${row * cols + col + 1}`
}
function gridCells(vw, vh, rows, cols) {
  const cw = vw / cols, ch = vh / rows
  const cells = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let label
    if (rows === 1 && cols === 2) label = c === 0 ? 'L' : 'R'
    else if (rows === 2 && cols === 2) label = [['Q2','Q1'],['Q3','Q4']][r][c]
    else label = `Z${r * cols + c + 1}`
    cells.push({ x: c * cw, y: r * ch, w: cw, h: ch, label })
  }
  return cells
}
function quickAnomaly(score, prevBox, box) {
  const E = Math.min(1, score)
  const dx = box.x - (prevBox?.x ?? box.x), dy = box.y - (prevBox?.y ?? box.y)
  const B = Math.min(1, Math.sqrt(dx*dx + dy*dy) / 20)
  const R = score > 0.98 ? 0.8 : 0.1
  return parseFloat((0.30*(1-E) + 0.25*(1-B) + 0.20*0.5 + 0.25*R).toFixed(3))
}
function statusOf(anomaly) {
  if (anomaly > 0.65) return { label: 'PROXY',      color: '#ef4444' }
  if (anomaly > 0.40) return { label: 'SUSPICIOUS', color: '#f59e0b' }
  return                     { label: 'PRESENT',    color: '#22c55e' }
}

// ─── Live Camera Tab ──────────────────────────────────────────────────────────
function LiveCameraTab({ teacherId }) {
  const [modelsReady, setModelsReady] = useState(false)
  const [isTracking, setIsTracking]   = useState(false)
  const [faces, setFaces]             = useState([])
  const [logs, setLogs]               = useState([])
  const [sheet, setSheet]             = useState({})
  const [gridMode, setGridMode]       = useState('1×2')
  const [videoDims, setVideoDims]     = useState({ w: 0, h: 0 })

  // ── Section picker state ──────────────────────────────────────────────────
  const [sections, setSections]               = useState([])
  const [selectedSection, setSelectedSection] = useState(null)
  const [showPicker, setShowPicker]           = useState(false)
  const [finalizing, setFinalizing]           = useState(false)
  const [finalResult, setFinalResult]         = useState(null)  // { present, absent, emails_queued }

  const videoRef  = useRef(null)
  const streamRef = useRef(null)
  const rafRef    = useRef(null)
  const backendRef = useRef(null)
  const facesRef  = useRef([])
  const prevBoxes = useRef({})
  const counter   = useRef(0)
  const lastSheet = useRef(0)
  const syncBackendRef = useRef(null)          // always-current syncBackend, no stale closure
  const selectedSectionRef = useRef(null)      // mirror of selectedSection for use in callbacks

  useEffect(() => {
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL)
      .then(() => faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL))
      .then(() => faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL))
      .then(() => setModelsReady(true))
  }, [])

  // Fetch teacher's sections for the picker
  useEffect(() => {
    fetch(`${API}/sections/${teacherId}`)
      .then(r => r.ok ? r.json() : [])
      .then(setSections)
      .catch(() => {})
  }, [teacherId])

  const detectLoop = useCallback(async () => {
    const video = videoRef.current
    if (!video || video.readyState < 2) { rafRef.current = requestAnimationFrame(detectLoop); return }
    const vw = video.videoWidth || video.clientWidth
    const vh = video.videoHeight || video.clientHeight
    setVideoDims({ w: vw, h: vh })
    const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 })
    const detections = await faceapi.detectAllFaces(video, opts).withFaceLandmarks(true).withFaceDescriptors()
    const { rows, cols } = selectGrid(detections.length || 1)
    setGridMode(`${rows}×${cols}`)
    const newFaces = detections.map((d, i) => {
      const box = d.detection.box
      const score = d.detection.score
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2
      const quadrant = assignQuadrant(cx, cy, vw, vh, rows, cols)
      const anomaly = quickAnomaly(score, prevBoxes.current[i], box)
      prevBoxes.current[i] = box
      return { id: i, label: `Student ${i+1}`, box, score: parseFloat(score.toFixed(3)), anomaly, isProxy: anomaly > 0.65, quadrant, landmarks: d.landmarks.positions.map(p => ({ x: p.x, y: p.y })), descriptor: Array.from(d.descriptor), cx, cy }
    })
    setFaces(newFaces)
    facesRef.current = newFaces
    const now = Date.now()
    if (newFaces.length > 0 && now - lastSheet.current > 500) {
      lastSheet.current = now
      const ts = new Date().toLocaleTimeString()
      setSheet(prev => {
        const next = { ...prev }
        newFaces.forEach(f => {
          const key = `face-${f.id}`
          const ex = next[key]
          const num = ex ? ex.studentNum : ++counter.current
          next[key] = { key, studentNum: num, label: `Student ${num}`, latestQuadrant: f.quadrant, latestCFace: f.score, latestAnomaly: f.anomaly, latestCx: f.cx, latestCy: f.cy, count: (ex?.count ?? 0) + 1, lastSeen: ts, phase: ex?.phase ?? 1, absenceMin: ex?.absenceMin ?? 0 }
        })
        return next
      })
    }
    rafRef.current = requestAnimationFrame(detectLoop)
  }, [])

  const syncBackend = useCallback(async () => {
    const cf = facesRef.current
    if (!videoRef.current || cf.length === 0) return
    const canvas = document.createElement('canvas')
    canvas.width = videoRef.current.videoWidth || 640
    canvas.height = videoRef.current.videoHeight || 480
    canvas.getContext('2d').drawImage(videoRef.current, 0, 0)
    const b64 = canvas.toDataURL('image/jpeg', 0.6)
    const currentSection = selectedSectionRef.current
    try {
      const res = await fetch(`${API}/verify-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frame_base64: b64,
          timestamp: Date.now() / 1000,
          session_id: currentSection?.id || null,
        }),
      })
      const data = await res.json()
      const displayName = data.student_name && data.student_name !== 'Unknown'
        ? data.student_name : data.student_id

      setFaces(prev => prev.map((f, i) => i === 0 ? { ...f, label: displayName } : f))

      setLogs(prev => [{
        id: Date.now(),
        student_id:         data.student_id,
        student_name:       data.student_name || data.student_id,
        quadrant:           data.quadrant,
        anomaly_score:      data.anomaly_score ?? cf[0]?.anomaly,
        c_face:             data.c_face ?? cf[0]?.score,
        final_score:        data.final_attendance_score ?? 0,
        is_proxy:           data.is_proxy ?? cf[0]?.isProxy,
        phase:              data.phase ?? 1,
        absence_minutes:    data.absence_minutes ?? 0,
        euclidean_distance: data.euclidean_distance,
        time: new Date().toLocaleTimeString(),
      }, ...prev].slice(0, 40))

      if (data.student_id && data.student_id !== 'unknown') {
        setSheet(prev => {
          const key = 'face-0'
          if (!prev[key]) return prev
          return { ...prev, [key]: { ...prev[key], label: data.student_name || data.student_id } }
        })
      }
    } catch {
      cf.forEach(f => setLogs(prev => [{
        id: Date.now() + f.id, student_id: f.label, student_name: f.label,
        quadrant: f.quadrant, anomaly_score: f.anomaly, c_face: f.score,
        final_score: parseFloat((0.7*f.score + 0.3*(1-f.anomaly)).toFixed(3)),
        is_proxy: f.isProxy, phase: 1, absence_minutes: 0,
        time: new Date().toLocaleTimeString(),
      }, ...prev].slice(0, 40)))
    }
  }, [])   // no deps — uses refs only

  // Keep syncBackendRef always pointing to latest syncBackend
  syncBackendRef.current = syncBackend

  const startTracking = async () => {
    if (!modelsReady) return
    if (!selectedSection) { setShowPicker(true); return }
    await _doStartTracking()
  }

  const _doStartTracking = async (sectionOverride) => {
    // Accept section as parameter to avoid stale state when called from picker
    const section = sectionOverride || selectedSection
    if (section && !selectedSection) setSelectedSection(section)
    setShowPicker(false)
    setIsTracking(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play() }
    } catch (e) { console.warn('Camera:', e) }
    rafRef.current = requestAnimationFrame(detectLoop)
    backendRef.current = setInterval(syncBackendRef.current, 2000)
  }

  // Keep selectedSectionRef in sync
  useEffect(() => { selectedSectionRef.current = selectedSection }, [selectedSection])

  const stopTracking = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    clearInterval(backendRef.current)
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    if (videoRef.current) videoRef.current.srcObject = null
    setIsTracking(false); setFaces([]); setSheet({}); counter.current = 0; prevBoxes.current = {}
  }, [])

  const finalizeSession = async () => {
    if (!selectedSection) return
    setFinalizing(true)
    try {
      const res = await fetch(`${API}/session/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section_id:   selectedSection.id,
          section_name: selectedSection.name,
          subject:      selectedSection.subject || null,
        }),
      })
      const data = await res.json()

      // ── Send emails via Gmail API if teacher signed in with Google ──────────
      if (googleAccessToken && data.absentees?.length > 0) {
        const date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
        let gmailSent = 0

        for (const rollNo of data.absentees) {
          // Get student name from logs
          const studentLog = logs.find(l => l.student_id === rollNo)
          const name = studentLog?.student_name || rollNo

          // Derive email: stored Google email or MNIT formula
          const storedEmail = localStorage.getItem(`ef_google_email_${rollNo}`)
          const toEmail = storedEmail || `${rollNo.toLowerCase()}@mnit.ac.in`

          const html = buildAbsenceEmail(name, rollNo, selectedSection.name, selectedSection.subject || '', date)
          const ok = await sendViaGmail(toEmail, `📋 Attendance: You were Absent Today [${date}]`, html)
          if (ok) gmailSent++
        }

        setFinalResult({ ...data, emails_queued: gmailSent, via: 'Gmail' })
      } else {
        setFinalResult(data)
      }

      stopTracking()
    } catch {
      alert('Could not finalize — check backend connection.')
    } finally { setFinalizing(false) }
  }

  useEffect(() => () => stopTracking(), [stopTracking])
  // No separate interval re-attach needed — syncBackendRef always points to latest

  const exportCSV = () => {
    const rows = Object.values(sheet).sort((a,b) => a.studentNum - b.studentNum)
    const header = ['#','Student','Quadrant','Cx','Cy','Status','C_face','Anomaly','Phase','Absence(min)','Detections','Last Seen']
    const lines = rows.map(r => [r.studentNum, r.label, r.latestQuadrant, r.latestCx?.toFixed(0), r.latestCy?.toFixed(0), statusOf(r.latestAnomaly).label, r.latestCFace?.toFixed(3), r.latestAnomaly?.toFixed(3), `P${r.phase}`, (r.absenceMin??0).toFixed(1), r.count, r.lastSeen].join(','))
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `session-${Date.now()}.csv`; a.click()
  }

  const sheetRows = Object.values(sheet).sort((a,b) => a.studentNum - b.studentNum)
  const stats = { total: logs.length, present: logs.filter(l => !l.is_proxy && l.anomaly_score <= 0.40).length, suspicious: logs.filter(l => !l.is_proxy && l.anomaly_score > 0.40).length, proxy: logs.filter(l => l.is_proxy).length }

  return (
    <div className="max-w-7xl mx-auto px-4 -mt-8 pb-12 space-y-5">

      {/* ── Section Picker Modal ── */}
      {showPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
            {/* Header */}
            <div className="bg-[#0a1628] px-6 py-5">
              <h2 className="text-xl font-black text-white">Select Section</h2>
              <p className="text-blue-300 text-sm mt-1">
                Choose which section you're taking attendance for
              </p>
            </div>
            <div className="p-6 space-y-3">
              {sections.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <p className="font-semibold">No sections found.</p>
                  <p className="text-sm mt-1">Go to the Attendance tab to create a section first.</p>
                </div>
              ) : (
                sections.map(s => (
                  <button key={s.id} onClick={() => { setSelectedSection(s); _doStartTracking() }}
                    className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-slate-200 hover:border-[#0a1628] hover:bg-slate-50 transition-all text-left group">
                    <div className="w-12 h-12 rounded-2xl bg-[#0a1628] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                      <span className="text-white font-black text-lg">{s.name[0].toUpperCase()}</span>
                    </div>
                    <div>
                      <p className="font-black text-[#0a1628] text-base">{s.name}</p>
                      {s.subject && <p className="text-slate-500 text-sm">{s.subject}</p>}
                    </div>
                    <ArrowLeft size={18} className="ml-auto text-slate-300 group-hover:text-[#0a1628] rotate-180 transition-colors" />
                  </button>
                ))
              )}
              <button onClick={() => setShowPicker(false)}
                className="w-full py-3 rounded-2xl border border-slate-200 text-slate-500 text-sm font-medium hover:bg-slate-50 transition mt-2">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Finalize result banner ── */}
      {finalResult && (
        <div className="bg-white border-2 border-emerald-300 rounded-2xl p-6 flex items-start gap-4 shadow-md">
          <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
            <CheckCircle2 size={24} className="text-emerald-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-black text-[#0a1628] text-lg">Session Finalized</h3>
            <div className="flex gap-6 mt-2 text-sm">
              <span className="text-emerald-600 font-bold">{finalResult.present} Present</span>
              <span className="text-red-500 font-bold">{finalResult.absent} Absent</span>
              <span className="text-indigo-600 font-semibold">{finalResult.emails_queued} absence email{finalResult.emails_queued !== 1 ? 's' : ''} sent{finalResult.via ? ` via ${finalResult.via}` : ''}</span>
            </div>
            {finalResult.absentees?.length > 0 && (
              <p className="text-xs text-slate-500 mt-1">
                Absentees: {finalResult.absentees.join(', ')}
              </p>
            )}
          </div>
          <button onClick={() => setFinalResult(null)} className="text-slate-400 hover:text-slate-600 text-xs">Dismiss</button>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[['Total', stats.total, 'bg-indigo-500/10 text-indigo-600'], ['Present', stats.present, 'bg-green-500/10 text-green-600'], ['Suspicious', stats.suspicious, 'bg-amber-500/10 text-amber-600'], ['Proxy', stats.proxy, 'bg-red-500/10 text-red-600']].map(([label, val, cls]) => (
          <div key={label} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3 shadow-sm">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-lg ${cls}`}>{val}</div>
            <span className="text-sm font-bold text-slate-600">{label}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Video */}
        <div className="col-span-2 bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isTracking ? 'bg-indigo-500 animate-pulse' : 'bg-slate-300'}`} />
              <span className="text-sm font-bold text-slate-700">
                {selectedSection ? `${selectedSection.name}${selectedSection.subject ? ` · ${selectedSection.subject}` : ''}` : 'CAMERA 01'}
              </span>
              {selectedSection && !isTracking && (
                <button onClick={() => setShowPicker(true)}
                  className="text-xs text-indigo-500 hover:underline font-medium ml-1">
                  Change
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {isTracking && <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">{faces.length} face{faces.length !== 1 ? 's' : ''}</span>}
              {isTracking && <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">Grid {gridMode}</span>}
              <button onClick={isTracking ? finalizeSession : startTracking} disabled={!modelsReady || finalizing}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition disabled:opacity-40 ${isTracking ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100' : 'bg-[#0a1628] text-white hover:bg-[#162444]'}`}>
                {!modelsReady
                  ? <><Loader2 size={12} className="animate-spin" />Loading...</>
                  : finalizing
                    ? <><Loader2 size={12} className="animate-spin" />Finalizing...</>
                    : isTracking
                      ? <><EyeOff size={12} />End Session & Email Absentees</>
                      : <><Eye size={12} />Start Session</>}
              </button>
            </div>
          </div>

          <div className="relative bg-slate-950" style={{ aspectRatio: '16/9' }}>
            <video ref={videoRef} autoPlay muted playsInline className={`w-full h-full object-cover ${isTracking ? 'block' : 'hidden'}`} />
            {isTracking && videoDims.w > 0 && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${videoDims.w} ${videoDims.h}`} preserveAspectRatio="none">
                {gridCells(videoDims.w, videoDims.h, selectGrid(faces.length||1).rows, selectGrid(faces.length||1).cols).map(({ x, y, w, h, label }) => (
                  <g key={label}>
                    <rect x={x} y={y} width={w} height={h} fill="none" stroke="rgba(99,102,241,.35)" strokeWidth="1.5" strokeDasharray="6 4" />
                    <text x={x+w/2} y={y+h/2} textAnchor="middle" dominantBaseline="middle" fill="rgba(99,102,241,.18)" fontSize={Math.min(w,h)*0.28} fontWeight="900" fontFamily="monospace">{label}</text>
                  </g>
                ))}
                {faces.map((f, i) => {
                  const { color } = statusOf(f.anomaly)
                  const { x, y, width: w, height: h } = f.box
                  const { rows, cols } = selectGrid(faces.length || 1)
                  const q = assignQuadrant(f.cx, f.cy, videoDims.w, videoDims.h, rows, cols)
                  return (
                    <g key={i}>
                      <rect x={x} y={y} width={w} height={h} fill="none" stroke={color} strokeWidth="2.5" rx="5" />
                      <rect x={x} y={Math.max(y-24,0)} width={Math.max(w+20,130)} height={22} fill={color} rx="4" />
                      <text x={x+6} y={Math.max(y-8,14)} fill="#0f172a" fontSize="11" fontWeight="700" fontFamily="monospace">{f.label} · {q}</text>
                      <circle cx={f.cx} cy={f.cy} r="5" fill={color} opacity=".75" />
                    </g>
                  )
                })}
              </svg>
            )}
            {!isTracking && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600 gap-3">
                <Camera size={56} className="opacity-20" />
                {!modelsReady
                  ? <p className="text-sm">Loading face detection models…</p>
                  : selectedSection
                    ? <p className="text-sm">Section: <b className="text-slate-800">{selectedSection.name}</b> — click Start Session</p>
                    : <p className="text-sm">Click <b className="text-slate-800">Start Session</b> to select a section and begin</p>
                }
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-4 px-4 py-3 border-t border-slate-100 items-center">
            {[['#22c55e','Present'],['#f59e0b','Suspicious'],['#ef4444','Proxy']].map(([c,l]) => (
              <div key={l} className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm" style={{ background: c }} /><span className="text-xs text-slate-500">{l}</span></div>
            ))}
            <span className="ml-auto text-[11px] text-slate-400 font-mono">≤2→1×2 · ≤12→2×2 · &gt;12→3×3</span>
          </div>
        </div>

        {/* Live stream */}
        <div className="bg-white border border-slate-200 rounded-2xl flex flex-col overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity size={15} className="text-indigo-500" />
              <span className="text-sm font-bold text-slate-700">Live Events</span>
            </div>
            {selectedSection && (
              <span className="text-xs bg-indigo-50 border border-indigo-200 text-indigo-600 px-2 py-0.5 rounded-full font-semibold">
                {selectedSection.name}
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 max-h-[480px]">
            {logs.length === 0 ? <p className="text-slate-400 text-sm text-center mt-12">No events yet.</p> : logs.map(log => {
              const s = statusOf(log.anomaly_score)
              return (
                <div key={log.id} className="p-3 rounded-xl text-xs border" style={{ borderColor: s.color+'40', background: s.color+'0d' }}>
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <span className="font-bold text-slate-800 text-sm">{log.student_name || log.student_id}</span>
                      {log.student_name && log.student_name !== log.student_id && (
                        <span className="text-slate-400 text-xs ml-1.5 font-mono">({log.student_id})</span>
                      )}
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: s.color+'25', color: s.color }}>{s.label}</span>
                  </div>
                  <div className="text-slate-500 space-y-0.5">
                    <div className="flex justify-between"><span>Quadrant: <b className="text-slate-700">{log.quadrant}</b></span><span>{log.time}</span></div>
                    <div className="flex justify-between">
                      <span>C_face: <b className="text-slate-700">{log.c_face?.toFixed(3)}</b></span>
                      <span>Anomaly: <b style={{ color: s.color }}>{log.anomaly_score?.toFixed(3)}</b></span>
                    </div>
                    {log.euclidean_distance != null && (
                      <div className="text-slate-400">
                        L2 dist: <b className="text-slate-600">{log.euclidean_distance.toFixed(2)}</b>
                        <span className={`ml-2 text-[10px] font-bold ${log.euclidean_distance < 10 ? 'text-emerald-600' : log.euclidean_distance < 15 ? 'text-amber-500' : 'text-rose-500'}`}>
                          {log.euclidean_distance < 10 ? '✓ Strong match' : log.euclidean_distance < 15 ? '~ Weak match' : '✗ No match'}
                        </span>
                      </div>
                    )}
                    {log.absence_minutes > 0 && <div className="text-amber-600 font-semibold">Absent: {log.absence_minutes.toFixed(1)}m · P{log.phase}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Datasheet */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Users size={15} className="text-indigo-500" />
            <span className="text-sm font-bold text-slate-700">Session Datasheet</span>
            <span className="px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-600 text-xs font-bold">{sheetRows.length} students</span>
          </div>
          <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 text-xs font-medium transition">
            <Download size={13} /> Export CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs text-slate-400 uppercase tracking-wider bg-slate-50">
                {['#','Student','Location','Attendance','Confidence','Anomaly','Phase','Absence','Detections','Last Seen'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheetRows.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-10 text-slate-400 text-sm">No students detected — start a session</td></tr>
              ) : sheetRows.map(row => {
                const s = statusOf(row.latestAnomaly)
                return (
                  <tr key={row.key} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{row.studentNum}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: s.color+'20', color: s.color, border: `1.5px solid ${s.color}40` }}>{row.studentNum}</div>
                        <span className="font-semibold text-slate-800 text-sm">{row.label}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-bold font-mono">
                        <MapPin size={10} />{row.latestQuadrant}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold" style={{ background: s.color+'15', color: s.color, border: `1px solid ${s.color}30` }}>
                        {s.label === 'PRESENT' ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}{s.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 font-mono text-xs">{row.latestCFace?.toFixed(3)}</td>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: s.color }}>{row.latestAnomaly?.toFixed(3)}</td>
                    <td className="px-4 py-3">
                      {row.phase === 1 && <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-xs font-mono">P1</span>}
                      {row.phase === 2 && <span className="px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-600 text-xs font-bold">P2 Warn</span>}
                      {row.phase === 3 && <span className="px-2 py-0.5 rounded-md bg-red-50 border border-red-200 text-red-600 text-xs font-bold">P3 Absent</span>}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono" style={{ color: (row.absenceMin??0) >= 10 ? '#ef4444' : (row.absenceMin??0) >= 5 ? '#f59e0b' : '#94a3b8' }}>
                      {(row.absenceMin??0).toFixed(1)}m
                    </td>
                    <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-xs font-mono">{row.count}×</span></td>
                    <td className="px-4 py-3 text-slate-400 text-xs font-mono">{row.lastSeen}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Main Portal ──────────────────────────────────────────────────────────────
export default function TeacherPortal({ teacherId, role, onLogout }) {
  if (role !== 'teacher') return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white border-2 border-red-200 rounded-3xl p-10 text-center max-w-sm shadow-lg">
        <XCircle size={44} className="text-red-400 mx-auto mb-3" />
        <h2 className="text-xl font-black text-red-500 mb-2">Access Denied</h2>
        <p className="text-slate-500 text-sm">Only teachers can access this portal.</p>
      </div>
    </div>
  )

  const [activeSection, setActiveSection] = useState(null)
  const [portalTab, setPortalTab] = useState('camera') // 'camera' | 'attendance' | 'schedule'

  const TABS = [
    { key: 'camera',     label: '📷 Live Camera',  icon: <Camera size={15} /> },
    { key: 'attendance', label: '✅ Attendance',    icon: <Users size={15} /> },
    { key: 'schedule',   label: '📅 My Schedule',  icon: <CalendarDays size={15} /> },
  ]

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Nav */}
      <nav className="bg-[#0a1628] px-6 py-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          {activeSection && portalTab === 'attendance' && (
            <button onClick={() => setActiveSection(null)} className="text-blue-300 hover:text-white transition mr-1"><ArrowLeft size={20} /></button>
          )}
          <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center"><BookOpen size={18} className="text-[#0a1628]" /></div>
          <div>
            <span className="text-white font-black text-lg">Teacher Portal</span>
            <span className="text-blue-300 text-xs ml-2">
              {portalTab === 'schedule' ? 'My Schedule' : portalTab === 'camera' ? 'Live AI Detection' : activeSection ? `Section ${activeSection.name}` : 'MNIT Jaipur'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-blue-200 text-sm hidden sm:block">{teacherId}</span>
          <button onClick={onLogout} className="flex items-center gap-1.5 text-blue-300 hover:text-white transition text-sm font-medium"><LogOut size={15} /> Sign out</button>
        </div>
      </nav>

      {/* Hero */}
      <div className="bg-[#0a1628] pb-14 pt-8 px-6 text-center">
        <h1 className="text-3xl font-black text-white mb-1">
          {portalTab === 'camera' ? 'Live AI Attendance' : portalTab === 'schedule' ? 'My Schedule' : activeSection ? `Section ${activeSection.name}` : 'Section Management'}
        </h1>
        <p className="text-blue-300 text-sm">
          {portalTab === 'camera' ? 'Real-time face detection · Adaptive grid · Behavioral Trust Engine' : portalTab === 'schedule' ? 'Persistent class schedule — auto-saved' : 'Manage class sections and submit attendance'}
        </p>
      </div>

      {/* Tab switcher */}
      <div className="max-w-5xl mx-auto px-4 -mt-6 mb-0">
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 flex overflow-hidden">
          {TABS.map(t => (
            <button key={t.key} onClick={() => { setPortalTab(t.key); setActiveSection(null) }}
              className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-bold transition-colors ${portalTab === t.key ? 'bg-[#0a1628] text-white' : 'text-slate-500 hover:text-[#0a1628] hover:bg-slate-50'}`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        {portalTab === 'camera'     && <LiveCameraTab teacherId={teacherId} />}
        {portalTab === 'schedule'   && <TeacherSchedule teacherId={teacherId} />}
        {portalTab === 'attendance' && (
          activeSection
            ? <SectionMatrix teacherId={teacherId} section={activeSection} onBack={() => setActiveSection(null)} />
            : <SectionManager teacherId={teacherId} onOpen={setActiveSection} />
        )}
      </div>
    </div>
  )
}
