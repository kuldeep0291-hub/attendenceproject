import { useState, useEffect, useCallback } from 'react'
import { CalendarDays, Zap, LogOut, Bell, Target, Activity, ShieldCheck, AlertCircle } from 'lucide-react'
import Notifications from './Notifications'
import FocusUp from './FocusUp'
import { unreadCount, syncAttendanceNotifications, fetchBackendStats } from '../store'

export default function StudentHub({ userId, onPath, onLogout }) {
  const [tab, setTab]       = useState('home')
  const [badge, setBadge]   = useState(0)
  const [stats, setStats]   = useState(null)   // backend attendance stats

  const refreshBadge = useCallback(() => {
    syncAttendanceNotifications(userId)
    setBadge(unreadCount(userId))
  }, [userId])

  // Poll backend stats every 10s
  useEffect(() => {
    const load = async () => {
      const data = await fetchBackendStats(userId)
      if (data) setStats(data)
    }
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [userId])

  useEffect(() => {
    refreshBadge()
    const id = setInterval(refreshBadge, 4000)
    return () => clearInterval(id)
  }, [refreshBadge])

  const handleTabChange = (t) => {
    setTab(t)
    if (t === 'notifications') setTimeout(refreshBadge, 300)
  }

  const TABS = [
    { key: 'home',          label: 'Dashboard' },
    { key: 'focusup',       label: '⚡ FocusUp' },
    { key: 'notifications', label: 'Alerts', icon: <Bell size={13} /> },
  ]

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Nav */}
      <nav className="bg-[#0a1628] px-6 py-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center">
            <span className="text-lg">🎓</span>
          </div>
          <div>
            <span className="text-white font-black text-lg">EduFlow</span>
            <span className="text-blue-300 text-xs ml-2 font-medium">MNIT Jaipur</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-blue-200 text-sm hidden sm:block">{userId}</span>
          <button onClick={onLogout} className="flex items-center gap-1.5 text-blue-300 hover:text-white transition text-sm font-medium">
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </nav>

      {/* Hero with live backend stats */}
      <div className="bg-[#0a1628] pb-16 pt-10 px-6 text-center">
        <h1 className="text-4xl font-black text-white mb-2">Student Dashboard</h1>
        <p className="text-blue-300">Welcome back, <span className="font-bold text-white">{userId}</span></p>

        {/* Live stats strip */}
        {stats && (
          <div className="flex items-center justify-center gap-6 mt-5 flex-wrap">
            <div className="flex items-center gap-2 bg-white/10 rounded-xl px-4 py-2">
              <Activity size={14} className="text-blue-300" />
              <span className="text-white font-bold text-sm">{stats.attendance_percentage}%</span>
              <span className="text-blue-300 text-xs">Aacc</span>
            </div>
            <div className="flex items-center gap-2 bg-white/10 rounded-xl px-4 py-2">
              <ShieldCheck size={14} className={stats.attendance_status === 'Present' ? 'text-emerald-400' : stats.attendance_status === 'Warning' ? 'text-amber-400' : 'text-rose-400'} />
              <span className={`font-bold text-sm ${stats.attendance_status === 'Present' ? 'text-emerald-400' : stats.attendance_status === 'Warning' ? 'text-amber-400' : 'text-rose-400'}`}>
                {stats.attendance_status}
              </span>
            </div>
            {stats.warning_count > 0 && (
              <div className="flex items-center gap-2 bg-amber-500/20 rounded-xl px-4 py-2">
                <AlertCircle size={14} className="text-amber-400" />
                <span className="text-amber-300 text-xs font-bold">{stats.warning_count} warning{stats.warning_count > 1 ? 's' : ''}</span>
              </div>
            )}
            <div className="flex items-center gap-2 bg-white/10 rounded-xl px-4 py-2">
              <span className="text-white font-bold text-sm">{stats.safe_bunks_available}</span>
              <span className="text-blue-300 text-xs">safe bunks</span>
            </div>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="max-w-3xl mx-auto px-4 -mt-6 mb-6">
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 flex overflow-hidden">
          {TABS.map(t => (
            <button key={t.key} onClick={() => handleTabChange(t.key)}
              className={`relative flex-1 flex items-center justify-center gap-1.5 py-3.5 text-sm font-bold transition-colors
                ${tab === t.key ? 'bg-[#0a1628] text-white' : 'text-slate-500 hover:text-[#0a1628] hover:bg-slate-50'}`}>
              {t.icon}{t.label}
              {t.key === 'notifications' && badge > 0 && (
                <span className="absolute top-2 right-2 sm:static sm:ml-1 bg-red-500 text-white text-xs font-black px-1.5 py-0.5 rounded-full min-w-[20px] text-center leading-none">{badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Home tab */}
      {tab === 'home' && (
        <div className="max-w-3xl mx-auto px-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

            <button onClick={() => onPath('learning')}
              className="group bg-white border border-slate-200 rounded-2xl p-7 text-left shadow-md hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
              <div className="w-14 h-14 rounded-2xl bg-[#0a1628] flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                <Zap size={26} className="text-white" />
              </div>
              <h3 className="text-xl font-black text-[#0a1628] mb-2">Learning Mode</h3>
              <p className="text-slate-500 text-sm leading-relaxed">AI tutor, note summarizer & quiz generator.</p>
              <div className="mt-5 text-[#0a1628] text-sm font-bold">Start Learning →</div>
            </button>

            <button onClick={() => onPath('timetable')}
              className="group bg-[#0a1628] border border-[#162444] rounded-2xl p-7 text-left shadow-md hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
              <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                <CalendarDays size={26} className="text-white" />
              </div>
              <h3 className="text-xl font-black text-white mb-2">My Attendance</h3>
              <p className="text-blue-300 text-sm leading-relaxed">Timetable, attendance tracking & analytics.</p>
              <div className="mt-5 text-blue-300 text-sm font-bold">View Timetable →</div>
            </button>

            <button onClick={() => handleTabChange('focusup')}
              className="group rounded-2xl p-7 text-left shadow-md hover:shadow-xl hover:-translate-y-1 transition-all duration-300 border-2"
              style={{ background: '#e8f1fb', borderColor: '#1a6eb5' }}>
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 group-hover:scale-110 transition-transform" style={{ background: '#002147' }}>
                <Target size={26} className="text-white" />
              </div>
              <h3 className="text-xl font-black mb-2" style={{ color: '#002147' }}>FocusUp Suite</h3>
              <p className="text-slate-600 text-sm leading-relaxed">Stopwatch + TaskSprint with Zen chime & confetti.</p>
              <div className="mt-5 text-sm font-bold" style={{ color: '#1a6eb5' }}>Open FocusUp →</div>
            </button>

            <button onClick={() => handleTabChange('notifications')}
              className="group relative bg-white border border-slate-200 rounded-2xl p-7 text-left shadow-md hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
              {badge > 0 && (
                <span className="absolute top-4 right-4 bg-red-500 text-white text-xs font-black px-2 py-0.5 rounded-full">{badge} new</span>
              )}
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-5 group-hover:scale-110 transition-transform ${badge > 0 ? 'bg-red-500' : 'bg-slate-100'}`}>
                <Bell size={26} className={badge > 0 ? 'text-white' : 'text-slate-400'} />
              </div>
              <h3 className="text-xl font-black text-[#0a1628] mb-2">Notifications</h3>
              <p className="text-slate-500 text-sm leading-relaxed">
                {badge > 0 ? `${badge} unread alert${badge > 1 ? 's' : ''} waiting.` : 'Attendance alerts & updates.'}
              </p>
              <div className="mt-5 text-[#0a1628] text-sm font-bold">View Alerts →</div>
            </button>

          </div>
        </div>
      )}

      {tab === 'focusup' && <FocusUp userId={userId} />}
      {tab === 'notifications' && <Notifications userId={userId} />}
    </div>
  )
}
