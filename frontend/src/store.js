/**
 * EduFlow Data Store — localStorage + Backend API bridge
 *
 * localStorage keys:
 *   ef_users      → { [userId]: { password, role } }
 *   ef_session    → { userId, role, page }
 *   ef_tt_{uid}   → timetable object
 *   ef_att        → { [studentId]: { subject: { attended, total } } }
 *   ef_notifications → { [studentId]: [...] }
 *   ef_sections_{tid} → sections data
 *   ef_schedule_{tid} → teacher schedule
 */

export const API = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

export const DAYS  = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
export const SLOTS = ['8:00 AM','9:00 AM','10:00 AM','11:00 AM','12:00 PM','1:00 PM','2:00 PM','3:00 PM','4:00 PM']
export const LUNCH_SLOT = '1:00 PM'

// Sunday only has 10 AM and 11 AM slots (10:00–12:00 block)
export const SUNDAY_SLOTS = ['10:00 AM', '11:00 AM']
export const SUNDAY_LABEL = '10:00 AM – 12:00 PM'

// ─── Users ────────────────────────────────────────────────────────────────────
const USERS_KEY = 'ef_users'

function getUsers() {
  const raw = localStorage.getItem(USERS_KEY)
  if (raw) return JSON.parse(raw)
  const defaults = {
    teacher01:    { password: 'teach123', role: 'teacher' },
    '2022UCS1234': { password: 'pass1234', role: 'student' },
    '2022UCS5678': { password: 'pass5678', role: 'student' },
  }
  localStorage.setItem(USERS_KEY, JSON.stringify(defaults))
  return defaults
}

export function authenticate(userId, password) {
  const users = getUsers()
  const user  = users[userId.trim()]
  if (!user || user.password !== password) return null
  return { userId: userId.trim(), role: user.role }
}

export function registerUser(userId, password, role) {
  const id = userId.trim()
  if (!id || !password || !role) return { ok: false, error: 'All fields required.' }
  const users = getUsers()
  if (users[id]) return { ok: false, error: 'User ID already exists.' }
  users[id] = { password, role }
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
  return { ok: true }
}

export function getStudentIds() {
  return Object.entries(getUsers())
    .filter(([, v]) => v.role === 'student')
    .map(([id]) => id)
}

// ─── Session ──────────────────────────────────────────────────────────────────
const SESSION_KEY = 'ef_session'
export function saveSession(userId, role, page) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, role, page }))
}
export function loadSession() {
  const raw = localStorage.getItem(SESSION_KEY)
  return raw ? JSON.parse(raw) : null
}
export function clearSession() { localStorage.removeItem(SESSION_KEY) }

// ─── Timetable ────────────────────────────────────────────────────────────────
export function buildEmptyTimetable() {
  const data = {}
  DAYS.forEach(day => { data[day] = {}; SLOTS.forEach(slot => { data[day][slot] = '' }) })
  return data
}
export function getTimetable(userId) {
  const raw = localStorage.getItem(`ef_tt_${userId}`)
  return raw ? JSON.parse(raw) : buildEmptyTimetable()
}
export function saveTimetable(userId, data) {
  localStorage.setItem(`ef_tt_${userId}`, JSON.stringify(data))
}

// ─── Attendance ───────────────────────────────────────────────────────────────
const ATT_KEY = 'ef_att'
export function getAllAttendance() {
  const raw = localStorage.getItem(ATT_KEY)
  return raw ? JSON.parse(raw) : {}
}
export function getStudentSubjectAttendance(studentId) {
  return getAllAttendance()[studentId] || {}
}

export function submitAttendanceMatrix(role, rows) {
  if (role !== 'teacher') return false
  const all = getAllAttendance()
  const now = new Date()
  const dateLabel = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const timeLabel = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })

  rows.forEach(({ studentId, subject, status }) => {
    if (!studentId || !subject || !status) return
    if (!all[studentId]) all[studentId] = {}
    if (!all[studentId][subject]) all[studentId][subject] = { attended: 0, total: 0 }
    all[studentId][subject].total += 1
    if (status === 'present') {
      all[studentId][subject].attended += 1
    } else {
      pushNotification(studentId, 'info',
        `🔵 NEW UPDATE: You were marked **Absent** for **${subject}** on ${dateLabel} at ${timeLabel}.`)
    }
  })
  localStorage.setItem(ATT_KEY, JSON.stringify(all))
  const affected = [...new Set(rows.map(r => r.studentId).filter(Boolean))]
  affected.forEach(sid => syncAttendanceNotifications(sid))
  return true
}

export function getSubjectStats(userId, timetable) {
  const attData  = getStudentSubjectAttendance(userId)
  const subjects = new Set()
  DAYS.forEach(day => SLOTS.forEach(slot => {
    if (slot === LUNCH_SLOT) return
    const s = timetable?.[day]?.[slot]?.trim()
    if (s) subjects.add(s)
  }))
  const stats = {}
  subjects.forEach(sub => { stats[sub] = attData[sub] || { attended: 0, total: 0 } })
  return stats
}

// ─── Backend attendance sync ──────────────────────────────────────────────────
export async function fetchBackendStats(rollNo) {
  try {
    const res = await fetch(`${API}/student/stats/${rollNo}`)
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

export async function fetchAlarmStates() {
  try {
    const res = await fetch(`${API}/alarm/states`)
    if (!res.ok) return []
    return await res.json()
  } catch { return [] }
}

/**
 * Pull ManualAttendanceRecord from backend for a student and merge into
 * local attendance store so the Analytics pie charts reflect live session data.
 *
 * Called automatically when student opens the Timetable/Analytics tab.
 */
export async function syncBackendAttendanceToStudent(rollNo) {
  try {
    const res = await fetch(`${API}/attendance/manual/student/${rollNo}`)
    if (!res.ok) return

    const data = await res.json()
    if (!data.records || data.records.length === 0) return

    const all = getAllAttendance()
    if (!all[rollNo]) all[rollNo] = {}

    // Group records by subject and count present/total
    const subjectMap = {}
    data.records.forEach(r => {
      const subj = r.subject || r.section || 'Unknown'
      if (!subjectMap[subj]) subjectMap[subj] = { attended: 0, total: 0 }
      subjectMap[subj].total += 1
      if (r.status === 'present') subjectMap[subj].attended += 1
    })

    // Merge — take the higher total to avoid overwriting manual entries
    Object.entries(subjectMap).forEach(([subj, counts]) => {
      const existing = all[rollNo][subj]
      if (!existing || counts.total > existing.total) {
        all[rollNo][subj] = counts
      }
    })

    localStorage.setItem(ATT_KEY, JSON.stringify(all))
    syncAttendanceNotifications(rollNo)
  } catch { /* backend offline — use local data */ }
}

// ─── Notifications ────────────────────────────────────────────────────────────
const NOTIF_KEY = 'ef_notifications'
export function getAllNotifications() {
  const raw = localStorage.getItem(NOTIF_KEY)
  return raw ? JSON.parse(raw) : {}
}
export function getStudentNotifications(studentId) {
  return getAllNotifications()[studentId] || []
}
function saveAllNotifications(all) {
  localStorage.setItem(NOTIF_KEY, JSON.stringify(all))
}
export function pushNotification(studentId, type, message) {
  const all = getAllNotifications()
  if (!all[studentId]) all[studentId] = []
  const alreadyExists = all[studentId].some(n => !n.read && n.message === message)
  if (alreadyExists) return
  all[studentId].unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type, message,
    timestamp: new Date().toISOString(),
    read: false,
  })
  saveAllNotifications(all)
}
export function markAllNotificationsRead(studentId) {
  const all = getAllNotifications()
  if (!all[studentId]) return
  all[studentId] = all[studentId].map(n => ({ ...n, read: true }))
  saveAllNotifications(all)
}
export function clearNotifications(studentId) {
  const all = getAllNotifications()
  all[studentId] = []
  saveAllNotifications(all)
}
export function unreadCount(studentId) {
  return getStudentNotifications(studentId).filter(n => !n.read).length
}
export function syncAttendanceNotifications(studentId) {
  const attData = getStudentSubjectAttendance(studentId)
  Object.entries(attData).forEach(([subject, { attended, total }]) => {
    if (total === 0) return
    const pct = Math.round((attended / total) * 100)
    if (pct < 75) {
      pushNotification(studentId, 'critical',
        `🔴 CRITICAL: Your attendance in **${subject}** has dropped to **${pct}%**. You are below the mandatory 75% requirement.`)
    } else if (pct <= 80) {
      pushNotification(studentId, 'alert',
        `🟡 ALERT: Your attendance in **${subject}** is **${pct}%**. You are close to the 75% limit.`)
    }
  })
}

// ─── Teacher Sections ─────────────────────────────────────────────────────────
function sectionsKey(tid) { return `ef_sections_${tid}` }
export function getSections(tid) {
  const raw = localStorage.getItem(sectionsKey(tid))
  return raw ? JSON.parse(raw) : {}
}
function saveSections(tid, data) { localStorage.setItem(sectionsKey(tid), JSON.stringify(data)) }
export function addSection(tid, name) {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, error: 'Section name cannot be empty.' }
  const sections = getSections(tid)
  if (sections[trimmed]) return { ok: false, error: `Section "${trimmed}" already exists.` }
  sections[trimmed] = { rows: [], createdAt: new Date().toISOString() }
  saveSections(tid, sections)
  return { ok: true }
}
export function deleteSection(tid, name) {
  const sections = getSections(tid); delete sections[name]; saveSections(tid, sections)
}
export function saveSectionRows(tid, sectionName, rows) {
  const sections = getSections(tid)
  if (!sections[sectionName]) return
  sections[sectionName].rows = rows.map(r => ({
    studentId: r.studentId, photoDataUrl: r.photoDataUrl || null, status: r.status,
  }))
  saveSections(tid, sections)
}
export function getSectionRows(tid, sectionName) {
  return getSections(tid)[sectionName]?.rows || []
}
export function clearSection(tid, sectionName) {
  const sections = getSections(tid)
  if (sections[sectionName]) { sections[sectionName].rows = []; saveSections(tid, sections) }
}

// ─── Teacher Schedule ─────────────────────────────────────────────────────────
export function getTeacherSchedule(tid) {
  const raw = localStorage.getItem(`ef_schedule_${tid}`)
  return raw ? JSON.parse(raw) : []
}
export function saveTeacherSchedule(tid, rows) {
  localStorage.setItem(`ef_schedule_${tid}`, JSON.stringify(rows))
}
