import { useState, useEffect } from 'react'
import AuthPage      from './pages/AuthPage'
import StudentHub    from './pages/StudentHub'
import Timetable     from './pages/Timetable'
import TeacherPortal from './pages/TeacherPortal'
import LearningMode  from './pages/LearningMode'
import { loadSession, saveSession, clearSession } from './store'

export default function App() {
  const [page,   setPage]   = useState('auth')
  const [role,   setRole]   = useState(null)
  const [userId, setUserId] = useState(null)

  useEffect(() => {
    const s = loadSession()
    if (s?.userId) {
      setUserId(s.userId); setRole(s.role)
      setPage(s.page || (s.role === 'teacher' ? 'teacher' : 'student-hub'))
    }
  }, [])

  const nav = (p, r = role, uid = userId) => {
    setPage(p); setRole(r); setUserId(uid)
    saveSession(uid, r, p)
  }

  const handleLogin = (uid, r) => nav(r === 'teacher' ? 'teacher' : 'student-hub', r, uid)
  const handleLogout = () => { clearSession(); setPage('auth'); setRole(null); setUserId(null) }

  return (
    <div className="min-h-screen bg-slate-50">
      {page === 'auth' && <AuthPage onLogin={handleLogin} />}

      {page === 'student-hub' && (
        <StudentHub userId={userId} onPath={p => nav(p)} onLogout={handleLogout} />
      )}

      {page === 'timetable' && (
        <Timetable userId={userId} onBack={() => nav('student-hub')} onLogout={handleLogout} />
      )}

      {page === 'teacher' && (
        <TeacherPortal teacherId={userId} role={role} onLogout={handleLogout} />
      )}

      {page === 'learning' && (
        <LearningMode userId={userId} onBack={() => nav('student-hub')} onLogout={handleLogout} />
      )}
    </div>
  )
}
