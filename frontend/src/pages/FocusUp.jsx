import { useState, useEffect, useRef, useCallback } from 'react'
import { Timer, Play, Pause, RotateCcw, Zap, Clock, Target,
         VolumeX, CheckCircle2, Plus, ArrowLeft, Flame } from 'lucide-react'
import { pushNotification } from '../store'

// ─── Navy palette (MNIT #002147) ──────────────────────────────────────────────
const NAVY   = '#002147'
const LBLUE  = '#1a6eb5'
const LBLUE2 = '#e8f1fb'

// ─── Web Audio chime (440 Hz, 5 s) ───────────────────────────────────────────
function playChime(onEnd) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(440, ctx.currentTime)
    gain.gain.setValueAtTime(0.4, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 5)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 5)
    osc.onended = () => { ctx.close(); onEnd?.() }
  } catch { onEnd?.() }
}

// ─── Confetti burst ───────────────────────────────────────────────────────────
function ConfettiBurst() {
  const pieces = Array.from({ length: 48 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    delay: Math.random() * 0.6,
    color: ['#002147','#1a6eb5','#f59e0b','#10b981','#ef4444','#8b5cf6'][i % 6],
    size: 6 + Math.random() * 8,
    rot: Math.random() * 360,
  }))
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {pieces.map(p => (
        <div key={p.id} className="absolute top-0 animate-confetti"
          style={{
            left: `${p.x}%`,
            animationDelay: `${p.delay}s`,
            width: p.size, height: p.size,
            background: p.color,
            borderRadius: Math.random() > 0.5 ? '50%' : '2px',
            transform: `rotate(${p.rot}deg)`,
          }} />
      ))}
    </div>
  )
}

// ─── Circular progress ring ───────────────────────────────────────────────────
function ProgressRing({ pct, size = 220, stroke = 14, children }) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - Math.min(pct, 1))
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke={LBLUE2} strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke={LBLUE} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {children}
      </div>
    </div>
  )
}

// ─── Format helpers ───────────────────────────────────────────────────────────
const fmt = (s) => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE A — STOPWATCH
// ═══════════════════════════════════════════════════════════════════════════════
function Stopwatch({ userId, onBack }) {
  const [elapsed, setElapsed] = useState(0)       // seconds
  const [running, setRunning] = useState(false)
  const lastHour = useRef(0)
  const intervalRef = useRef(null)

  // Persist elapsed across tab switches
  useEffect(() => {
    const saved = localStorage.getItem(`ef_sw_${userId}`)
    if (saved) setElapsed(parseInt(saved, 10) || 0)
  }, [userId])

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setElapsed(prev => {
          const next = prev + 1
          localStorage.setItem(`ef_sw_${userId}`, next)
          return next
        })
      }, 1000)
    } else {
      clearInterval(intervalRef.current)
    }
    return () => clearInterval(intervalRef.current)
  }, [running, userId])

  // Hourly milestone notifications
  useEffect(() => {
    const hours = Math.floor(elapsed / 3600)
    if (hours > 0 && hours !== lastHour.current) {
      lastHour.current = hours
      const msgs = [
        `🔥 Keep it up! You've been focused for **${hours} hour${hours > 1 ? 's' : ''}**. Great job!`,
        `⚡ ${hours}h of deep focus! You're crushing it — MNIT proud! 🎓`,
        `🏆 ${hours} hour${hours > 1 ? 's' : ''} of study time logged. Take a short break and keep going!`,
      ]
      pushNotification(userId, 'info', msgs[hours % msgs.length])
    }
  }, [elapsed, userId])

  const handleReset = () => {
    setRunning(false)
    setElapsed(0)
    lastHour.current = 0
    localStorage.removeItem(`ef_sw_${userId}`)
  }

  const hours   = Math.floor(elapsed / 3600)
  const minutes = Math.floor((elapsed % 3600) / 60)
  const seconds = elapsed % 60

  return (
    <div className="flex flex-col items-center gap-8 py-6">
      {/* Back */}
      <button onClick={onBack} className="self-start flex items-center gap-1.5 text-sm font-bold text-[#002147] hover:underline">
        <ArrowLeft size={15} /> Back
      </button>

      <div className="text-center">
        <h2 className="text-2xl font-black text-[#002147] mb-1">Continuous Stopwatch</h2>
        <p className="text-slate-500 text-sm">Track your total study time. Hourly milestones notify you automatically.</p>
      </div>

      {/* Big clock display */}
      <div className="bg-[#002147] rounded-3xl px-12 py-10 text-center shadow-2xl shadow-[#002147]/30 w-full max-w-sm">
        <div className="flex items-end justify-center gap-1 mb-2">
          {hours > 0 && (
            <>
              <span className="text-6xl font-black text-white tabular-nums">{String(hours).padStart(2,'0')}</span>
              <span className="text-3xl font-black text-blue-300 mb-2">h</span>
            </>
          )}
          <span className="text-6xl font-black text-white tabular-nums">{String(minutes).padStart(2,'0')}</span>
          <span className="text-3xl font-black text-blue-300 mb-2">m</span>
          <span className="text-6xl font-black text-white tabular-nums">{String(seconds).padStart(2,'0')}</span>
          <span className="text-3xl font-black text-blue-300 mb-2">s</span>
        </div>
        {hours > 0 && (
          <div className="flex items-center justify-center gap-1.5 mt-2">
            <Flame size={14} className="text-orange-400" />
            <span className="text-orange-300 text-xs font-bold">{hours} hour{hours > 1 ? 's' : ''} of focus!</span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => setRunning(r => !r)}
          className="flex items-center gap-2 px-8 py-3.5 rounded-2xl font-black text-white text-base shadow-lg transition-all active:scale-95"
          style={{ background: running ? '#dc2626' : NAVY }}
        >
          {running ? <><Pause size={20} /> Pause</> : <><Play size={20} /> {elapsed > 0 ? 'Resume' : 'Start'}</>}
        </button>
        <button
          onClick={handleReset}
          className="flex items-center gap-2 px-5 py-3.5 rounded-2xl font-bold text-slate-600 bg-white border-2 border-slate-200 hover:border-slate-400 transition-all active:scale-95"
        >
          <RotateCcw size={18} /> Reset
        </button>
      </div>

      {/* Milestone strip */}
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Milestones</p>
        <div className="flex gap-2 flex-wrap">
          {[1,2,3,4,5,6].map(h => (
            <div key={h}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition-all
                ${hours >= h ? 'bg-[#002147] border-[#002147] text-white' : 'border-slate-200 text-slate-400'}`}>
              <Flame size={11} /> {h}h
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE B — TASKSPRINT
// ═══════════════════════════════════════════════════════════════════════════════
const PRESETS = [15, 25, 45]

function TaskSprint({ userId, onBack }) {
  // Setup state
  const [goal, setGoal]           = useState('')
  const [totalSecs, setTotalSecs] = useState(25 * 60)
  const [customMin, setCustomMin] = useState('')
  const [started, setStarted]     = useState(false)

  // Timer state
  const [remaining, setRemaining] = useState(totalSecs)
  const [running, setRunning]     = useState(false)
  const [phase, setPhase]         = useState('idle') // idle | running | chiming | done

  // Chime state
  const [chiming, setChiming]     = useState(false)
  const [chimeSecs, setChimeSecs] = useState(5)

  // Extension state
  const [extMin, setExtMin]       = useState('')

  // Confetti
  const [confetti, setConfetti]   = useState(false)

  const intervalRef  = useRef(null)
  const chimeRef     = useRef(null)

  // ── Timer tick ──
  useEffect(() => {
    if (running && phase === 'running') {
      intervalRef.current = setInterval(() => {
        setRemaining(prev => {
          if (prev <= 1) {
            clearInterval(intervalRef.current)
            setRunning(false)
            setPhase('chiming')
            startChime()
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } else {
      clearInterval(intervalRef.current)
    }
    return () => clearInterval(intervalRef.current)
  }, [running, phase])

  // ── Chime countdown ──
  const startChime = () => {
    setChiming(true)
    setChimeSecs(5)
    playChime(() => {
      setChiming(false)
      setPhase('done')
    })
    chimeRef.current = setInterval(() => {
      setChimeSecs(s => {
        if (s <= 1) { clearInterval(chimeRef.current); return 0 }
        return s - 1
      })
    }, 1000)
  }

  const silenceChime = () => {
    clearInterval(chimeRef.current)
    setChiming(false)
    setPhase('done')
  }

  // ── Controls ──
  const handleStart = () => {
    setRemaining(totalSecs)
    setPhase('running')
    setRunning(true)
    setStarted(true)
  }

  const handlePauseResume = () => setRunning(r => !r)

  const handleReset = () => {
    clearInterval(intervalRef.current)
    clearInterval(chimeRef.current)
    setRunning(false)
    setPhase('idle')
    setStarted(false)
    setRemaining(totalSecs)
    setChiming(false)
    setConfetti(false)
    setExtMin('')
  }

  const handleComplete = () => {
    setConfetti(true)
    pushNotification(userId, 'info',
      `✅ TaskSprint complete! Goal: **${goal || 'Study session'}** — well done! 🎉`)
    setTimeout(() => {
      setConfetti(false)
      handleReset()
    }, 3500)
  }

  const handleExtend = () => {
    const mins = parseInt(extMin, 10)
    if (!mins || mins < 1) return
    const extra = mins * 60
    setTotalSecs(t => t + extra)
    setRemaining(extra)
    setPhase('running')
    setRunning(true)
    setExtMin('')
  }

  const handlePreset = (mins) => {
    setTotalSecs(mins * 60)
    setRemaining(mins * 60)
    setCustomMin('')
  }

  /**
   * Decimal minute logic:
   *   0.5  → 50 seconds
   *   1.5  → 1 min 50 sec  (floor(1.5)*60 + (0.5*100) = 60+50 = 110s)
   *   2.25 → 2 min 25 sec
   * Rule: integer part = minutes, decimal part × 100 = seconds
   */
  const decimalMinsToSecs = (val) => {
    const n = parseFloat(val)
    if (isNaN(n) || n <= 0) return null
    const wholeMins = Math.floor(n)
    const decPart   = Math.round((n - wholeMins) * 100) // e.g. 0.5 → 50
    return wholeMins * 60 + decPart
  }

  const handleCustom = (val) => {
    setCustomMin(val)
    const secs = decimalMinsToSecs(val)
    if (secs !== null) { setTotalSecs(secs); setRemaining(secs) }
  }

  const pct = totalSecs > 0 ? (totalSecs - remaining) / totalSecs : 0

  return (
    <div className="flex flex-col items-center gap-6 py-6">
      {confetti && <ConfettiBurst />}

      {/* Back */}
      <button onClick={onBack} className="self-start flex items-center gap-1.5 text-sm font-bold text-[#002147] hover:underline">
        <ArrowLeft size={15} /> Back
      </button>

      <div className="text-center">
        <h2 className="text-2xl font-black text-[#002147] mb-1">TaskSprint</h2>
        <p className="text-slate-500 text-sm">Set a goal, pick a duration, and sprint.</p>
      </div>

      {/* Goal input — always editable */}
      <div className="w-full max-w-sm">
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">
          What is your goal for this session?
        </label>
        <input
          type="text"
          value={goal}
          onChange={e => setGoal(e.target.value)}
          placeholder="e.g. Finish Chapter 5 of Signals & Systems"
          className="w-full border-2 border-slate-200 focus:border-[#002147] rounded-xl px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#002147]/10 transition"
        />
      </div>

      {/* Duration presets — only before start */}
      {!started && (
        <div className="w-full max-w-sm">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Duration</label>
          <div className="flex gap-2 flex-wrap">
            {PRESETS.map(m => (
              <button key={m} onClick={() => handlePreset(m)}
                className={`px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all
                  ${totalSecs === m * 60 && !customMin
                    ? 'bg-[#002147] border-[#002147] text-white'
                    : 'border-slate-200 text-slate-600 hover:border-[#002147] hover:text-[#002147]'}`}>
                {m} min
              </button>
            ))}
            <input
              type="number" min="0.1" max="180" step="0.1"
              value={customMin}
              onChange={e => handleCustom(e.target.value)}
              placeholder="e.g. 1.5"
              title="Decimal: 0.5 = 50s, 1.5 = 1m 50s"
              className="w-28 border-2 border-slate-200 focus:border-[#002147] rounded-xl px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none transition"
            />
          </div>
        </div>
      )}

      {/* Progress ring */}
      <ProgressRing pct={pct} size={220} stroke={14}>
        <div className="text-center">
          {phase === 'chiming' ? (
            <>
              <p className="text-4xl font-black text-[#002147]">⏰</p>
              <p className="text-sm font-bold text-[#1a6eb5] mt-1">Time's up!</p>
              {chiming && (
                <p className="text-xs text-slate-400 mt-0.5">Chime: {chimeSecs}s</p>
              )}
            </>
          ) : phase === 'done' ? (
            <>
              <CheckCircle2 size={40} className="text-green-500 mx-auto" />
              <p className="text-sm font-bold text-green-600 mt-1">Complete!</p>
            </>
          ) : (
            <>
              <p className="text-5xl font-black text-[#002147] tabular-nums">{fmt(remaining)}</p>
              <p className="text-xs text-slate-400 mt-1">
                {phase === 'idle' ? `${Math.round(totalSecs/60)} min session` : running ? 'In progress' : 'Paused'}
              </p>
            </>
          )}
        </div>
      </ProgressRing>

      {/* Silence chime button */}
      {chiming && (
        <button onClick={silenceChime}
          className="flex items-center gap-2 px-6 py-3 rounded-2xl font-bold text-white text-sm shadow-lg animate-pulse"
          style={{ background: LBLUE }}>
          <VolumeX size={18} /> Silence Chime
        </button>
      )}

      {/* Main controls */}
      {phase === 'idle' && (
        <button onClick={handleStart}
          className="flex items-center gap-2 px-10 py-4 rounded-2xl font-black text-white text-base shadow-xl active:scale-95 transition-all"
          style={{ background: NAVY }}>
          <Play size={20} /> Start Sprint
        </button>
      )}

      {phase === 'running' && (
        <div className="flex items-center gap-3">
          <button onClick={handlePauseResume}
            className="flex items-center gap-2 px-8 py-3.5 rounded-2xl font-black text-white text-base shadow-lg active:scale-95 transition-all"
            style={{ background: running ? '#dc2626' : NAVY }}>
            {running ? <><Pause size={20}/> Pause</> : <><Play size={20}/> Resume</>}
          </button>
          <button onClick={handleReset}
            className="flex items-center gap-2 px-5 py-3.5 rounded-2xl font-bold text-slate-600 bg-white border-2 border-slate-200 hover:border-slate-400 transition-all active:scale-95">
            <RotateCcw size={18} /> Reset
          </button>
        </div>
      )}

      {/* Post-chime actions */}
      {phase === 'done' && (
        <div className="w-full max-w-sm space-y-3">
          <button onClick={handleComplete}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-black text-white text-base shadow-lg active:scale-95 transition-all bg-green-600 hover:bg-green-500">
            <CheckCircle2 size={20} /> Task Complete 🎉
          </button>

          <div className="bg-white border-2 border-slate-200 rounded-2xl p-4">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Extend Session</p>
            <div className="flex gap-2">
              <input
                type="number" min="1" max="120"
                value={extMin}
                onChange={e => setExtMin(e.target.value)}
                placeholder="Extra minutes"
                className="flex-1 border-2 border-slate-200 focus:border-[#002147] rounded-xl px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none transition"
              />
              <button onClick={handleExtend}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl font-bold text-white text-sm active:scale-95 transition-all"
                style={{ background: LBLUE }}>
                <Plus size={15} /> Extend
              </button>
            </div>
          </div>

          <button onClick={handleReset}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl font-bold text-slate-500 bg-white border border-slate-200 hover:border-slate-400 transition-all text-sm">
            <RotateCcw size={15} /> Start Over
          </button>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// FOCUSUP LANDING
// ═══════════════════════════════════════════════════════════════════════════════
export default function FocusUp({ userId }) {
  const [mode, setMode] = useState(null) // null | 'stopwatch' | 'tasksprint'

  if (mode === 'stopwatch') return (
    <div className="max-w-lg mx-auto px-4 py-4">
      <Stopwatch userId={userId} onBack={() => setMode(null)} />
    </div>
  )

  if (mode === 'tasksprint') return (
    <div className="max-w-lg mx-auto px-4 py-4">
      <TaskSprint userId={userId} onBack={() => setMode(null)} />
    </div>
  )

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 shadow-lg"
          style={{ background: NAVY }}>
          <Zap size={30} className="text-white" />
        </div>
        <h2 className="text-3xl font-black text-[#002147] mb-2">FocusUp Suite</h2>
        <p className="text-slate-500 text-sm max-w-sm mx-auto">
          Two productivity tools built for MNIT students. Pick your mode and get into the zone.
        </p>
      </div>

      {/* Mode cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* Stopwatch */}
        <button
          onClick={() => setMode('stopwatch')}
          className="group text-left rounded-3xl p-8 shadow-xl hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 active:scale-98"
          style={{ background: NAVY }}
        >
          <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
            <Clock size={28} className="text-white" />
          </div>
          <h3 className="text-2xl font-black text-white mb-2">Continuous Stopwatch</h3>
          <p className="text-blue-200 text-sm leading-relaxed mb-6">
            Track total study time. Get motivational notifications every hour you stay focused.
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-blue-300 bg-white/10 px-3 py-1 rounded-full">Persistence Mode</span>
            <span className="text-xs font-bold text-orange-300 bg-white/10 px-3 py-1 rounded-full">🔥 Hourly Alerts</span>
          </div>
          <div className="mt-5 text-blue-300 text-sm font-bold group-hover:text-white transition-colors">
            Start Tracking →
          </div>
        </button>

        {/* TaskSprint */}
        <button
          onClick={() => setMode('tasksprint')}
          className="group text-left rounded-3xl p-8 shadow-xl hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 active:scale-98 border-2"
          style={{ background: LBLUE2, borderColor: LBLUE }}
        >
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform"
            style={{ background: LBLUE }}>
            <Target size={28} className="text-white" />
          </div>
          <h3 className="text-2xl font-black mb-2" style={{ color: NAVY }}>TaskSprint</h3>
          <p className="text-slate-600 text-sm leading-relaxed mb-6">
            Set a goal, pick 15/25/45 min or custom. Zen chime at the end. Extend or complete.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold px-3 py-1 rounded-full text-white" style={{ background: LBLUE }}>Interval Mode</span>
            <span className="text-xs font-bold px-3 py-1 rounded-full text-white bg-purple-500">🎵 Zen Chime</span>
            <span className="text-xs font-bold px-3 py-1 rounded-full text-white bg-green-600">🎉 Confetti</span>
          </div>
          <div className="mt-5 text-sm font-bold transition-colors" style={{ color: LBLUE }}>
            Start Sprint →
          </div>
        </button>
      </div>
    </div>
  )
}
