import { useEffect, useState, useCallback } from 'react'
import { Bell, BellOff, CheckCheck, Trash2, RefreshCw } from 'lucide-react'
import {
  getStudentNotifications,
  markAllNotificationsRead,
  clearNotifications,
  syncAttendanceNotifications,
  unreadCount,
} from '../store'

// Render inline **bold** markdown in notification messages
function NotifText({ text }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return (
    <span>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**')
          ? <strong key={i}>{p.slice(2, -2)}</strong>
          : p
      )}
    </span>
  )
}

function formatTime(iso) {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now - d
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay === 1) return 'Yesterday'
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

const TYPE_STYLES = {
  critical: {
    bar: 'bg-red-500',
    bg: 'bg-red-50 border-red-200',
    dot: 'bg-red-500',
    badge: 'bg-red-100 text-red-700',
    label: 'Critical',
  },
  alert: {
    bar: 'bg-yellow-400',
    bg: 'bg-yellow-50 border-yellow-200',
    dot: 'bg-yellow-400',
    badge: 'bg-yellow-100 text-yellow-700',
    label: 'Alert',
  },
  info: {
    bar: 'bg-blue-500',
    bg: 'bg-blue-50 border-blue-200',
    dot: 'bg-blue-500',
    badge: 'bg-blue-100 text-blue-700',
    label: 'Info',
  },
}

export default function Notifications({ userId }) {
  const [notifs, setNotifs] = useState([])

  const refresh = useCallback(() => {
    syncAttendanceNotifications(userId)
    setNotifs(getStudentNotifications(userId))
  }, [userId])

  useEffect(() => {
    refresh()
    // Poll every 4s to catch teacher updates in real time
    const id = setInterval(refresh, 4000)
    return () => clearInterval(id)
  }, [refresh])

  const handleMarkRead = () => {
    markAllNotificationsRead(userId)
    setNotifs(getStudentNotifications(userId))
  }

  const handleClear = () => {
    clearNotifications(userId)
    setNotifs([])
  }

  const unread = notifs.filter(n => !n.read).length

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header row */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Bell size={18} className="text-[#0a1628]" />
          <h2 className="font-black text-[#0a1628] text-lg">Notifications</h2>
          {unread > 0 && (
            <span className="bg-red-500 text-white text-xs font-black px-2 py-0.5 rounded-full min-w-[20px] text-center">
              {unread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-200 text-slate-500 hover:border-[#0a1628] hover:text-[#0a1628] transition bg-white"
          >
            <RefreshCw size={12} /> Refresh
          </button>
          {unread > 0 && (
            <button
              onClick={handleMarkRead}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-200 text-slate-500 hover:border-[#0a1628] hover:text-[#0a1628] transition bg-white"
            >
              <CheckCheck size={12} /> Mark all read
            </button>
          )}
          {notifs.length > 0 && (
            <button
              onClick={handleClear}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border border-red-200 text-red-500 hover:bg-red-50 transition bg-white"
            >
              <Trash2 size={12} /> Clear all
            </button>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        {Object.entries(TYPE_STYLES).map(([type, s]) => (
          <span key={type} className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className={`w-2.5 h-2.5 rounded-full ${s.dot}`} />
            {s.label}
          </span>
        ))}
      </div>

      {/* Empty state */}
      {notifs.length === 0 && (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
            <BellOff size={28} className="text-slate-300" />
          </div>
          <p className="font-bold text-slate-400 text-lg">You're all caught up!</p>
          <p className="text-slate-400 text-sm mt-1">No new notifications.</p>
        </div>
      )}

      {/* Notification list */}
      <div className="space-y-3">
        {notifs.map(n => {
          const s = TYPE_STYLES[n.type] || TYPE_STYLES.info
          return (
            <div
              key={n.id}
              className={`relative flex gap-0 rounded-2xl border overflow-hidden shadow-sm transition-all
                ${s.bg} ${!n.read ? 'shadow-md' : 'opacity-80'}`}
            >
              {/* Left color bar */}
              <div className={`w-1 shrink-0 ${s.bar}`} />

              <div className="flex-1 px-4 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    {/* Badge + unread dot */}
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`text-xs font-black px-2 py-0.5 rounded-full ${s.badge}`}>
                        {s.label}
                      </span>
                      {!n.read && (
                        <span className={`w-2 h-2 rounded-full ${s.dot} animate-pulse`} />
                      )}
                    </div>
                    <p className="text-sm text-slate-800 leading-relaxed">
                      <NotifText text={n.message} />
                    </p>
                  </div>
                  {/* Timestamp */}
                  <span className="text-xs text-slate-400 whitespace-nowrap shrink-0 mt-0.5">
                    {formatTime(n.timestamp)}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
