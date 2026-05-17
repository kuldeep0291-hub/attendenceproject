import { useState, useEffect } from 'react'
import { Eye, EyeOff, LogIn, UserPlus } from 'lucide-react'
import { useGoogleLogin } from '@react-oauth/google'
import { authenticate, registerUser, saveSession } from '../store'

// Store Google access token globally so email service can use it
export let googleAccessToken = null
export let googleUserEmail   = null

export default function AuthPage({ onLogin }) {
  const [tab, setTab] = useState('login')
  const [loginId, setLoginId] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [showLoginPass, setShowLoginPass] = useState(false)
  const [remember, setRemember] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [regId, setRegId] = useState('')
  const [regPass, setRegPass] = useState('')
  const [regPass2, setRegPass2] = useState('')
  const [regRole, setRegRole] = useState('student')
  const [showRegPass, setShowRegPass] = useState(false)
  const [regError, setRegError] = useState('')
  const [regSuccess, setRegSuccess] = useState('')
  const [regLoading, setRegLoading] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('ef_remember')
    if (saved) { setLoginId(saved); setRemember(true) }
  }, [])

  const handleLogin = (e) => {
    e.preventDefault()
    if (!loginId || !loginPass) { setLoginError('Please fill in all fields.'); return }
    setLoginError(''); setLoginLoading(true)
    setTimeout(() => {
      setLoginLoading(false)
      const user = authenticate(loginId, loginPass)
      if (!user) { setLoginError('Invalid User ID or password.'); return }
      if (remember) localStorage.setItem('ef_remember', loginId.trim())
      else localStorage.removeItem('ef_remember')
      onLogin(user.userId, user.role)
    }, 500)
  }

  // ── Google OAuth login ────────────────────────────────────────────────────
  const googleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      try {
        // Fetch user profile from Google
        const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
        })
        const profile = await profileRes.json()

        // Store token globally for email sending
        googleAccessToken = tokenResponse.access_token
        googleUserEmail   = profile.email

        // Derive role from email — teachers have non-student emails
        // Students: roll number pattern e.g. 2022ucs1234@mnit.ac.in
        const emailLocal = profile.email.split('@')[0]
        const isStudent  = /^\d{4}[a-z]{2,4}\d{4}$/i.test(emailLocal)
        const role       = isStudent ? 'student' : 'teacher'
        const userId     = emailLocal

        // Auto-register if not exists
        const users = JSON.parse(localStorage.getItem('ef_users') || '{}')
        if (!users[userId]) {
          users[userId] = { password: '__google__', role, googleEmail: profile.email, name: profile.name }
          localStorage.setItem('ef_users', JSON.stringify(users))
        }

        // Save Google email to student record for absence emails
        localStorage.setItem(`ef_google_email_${userId}`, profile.email)

        onLogin(userId, role)
      } catch (err) {
        setLoginError('Google sign-in failed. Please try again.')
      }
    },
    onError: () => setLoginError('Google sign-in was cancelled or failed.'),
    scope: 'email profile https://www.googleapis.com/auth/gmail.send',
  })

  const handleRegister = (e) => {
    e.preventDefault()
    setRegError(''); setRegSuccess('')
    if (!regId || !regPass || !regPass2) { setRegError('All fields are required.'); return }
    if (regPass !== regPass2) { setRegError('Passwords do not match.'); return }
    if (regPass.length < 6) { setRegError('Password must be at least 6 characters.'); return }
    setRegLoading(true)
    setTimeout(() => {
      setRegLoading(false)
      const result = registerUser(regId, regPass, regRole)
      if (!result.ok) { setRegError(result.error); return }
      setRegSuccess('Account created! You can now sign in.')
      setRegId(''); setRegPass(''); setRegPass2('')
      setTimeout(() => { setTab('login'); setRegSuccess('') }, 1500)
    }, 500)
  }

  return (
    <div className="min-h-screen bg-[#0a1628] flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-white/5" />
      <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] rounded-full bg-white/3" />
      <div className="absolute top-1/2 left-1/4 w-64 h-64 rounded-full bg-blue-500/10 blur-3xl" />
      <div className="w-full max-w-md z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-white mb-5 shadow-2xl">
            <span className="text-4xl">🎓</span>
          </div>
          <h1 className="text-5xl font-black text-white tracking-tight">EduFlow</h1>
          <p className="text-blue-300 font-semibold mt-2 tracking-[0.2em] text-sm uppercase">MNIT Jaipur</p>
        </div>
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
          <div className="flex border-b border-slate-100">
            <button onClick={() => setTab('login')} className={`flex-1 py-4 text-sm font-bold transition-colors ${tab === 'login' ? 'text-[#0a1628] border-b-2 border-[#0a1628]' : 'text-slate-400 hover:text-slate-600'}`}>Sign In</button>
            <button onClick={() => setTab('register')} className={`flex-1 py-4 text-sm font-bold transition-colors ${tab === 'register' ? 'text-[#0a1628] border-b-2 border-[#0a1628]' : 'text-slate-400 hover:text-slate-600'}`}>Create Account</button>
          </div>
          <div className="p-8">
            {tab === 'login' ? (
              <>
                <p className="text-slate-500 text-xs mb-5">Demo: <span className="font-mono text-slate-700">teacher01 / teach123</span> · <span className="font-mono text-slate-700">2022UCS1234 / pass1234</span></p>
                <form onSubmit={handleLogin} className="space-y-4">
                  <div><label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">User ID</label><input type="text" value={loginId} onChange={e => setLoginId(e.target.value)} placeholder="e.g. 2022UCS1234" className="input-field" /></div>
                  <div><label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Password</label>
                    <div className="relative">
                      <input type={showLoginPass ? 'text' : 'password'} value={loginPass} onChange={e => setLoginPass(e.target.value)} placeholder="••••••••" className="input-field pr-12" />
                      <button type="button" onClick={() => setShowLoginPass(!showLoginPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition">{showLoginPass ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setRemember(!remember)} className={`w-11 h-6 rounded-full transition-colors duration-300 relative ${remember ? 'bg-[#0a1628]' : 'bg-slate-200'}`}>
                      <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-300 ${remember ? 'left-6' : 'left-1'}`} />
                    </button>
                    <span className="text-sm text-slate-500">Remember me</span>
                  </div>
                  {loginError && <p className="text-red-500 text-sm font-medium">{loginError}</p>}
                  <button type="submit" disabled={loginLoading} className="btn-navy w-full flex items-center justify-center gap-2 mt-2">
                    {loginLoading ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><LogIn size={18} /> Sign In</>}
                  </button>
                </form>

                {/* Divider */}
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-slate-200" />
                  <span className="text-xs text-slate-400 font-medium">or</span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>

                {/* Google Sign-In */}
                {import.meta.env.VITE_GOOGLE_CLIENT_ID && !import.meta.env.VITE_GOOGLE_CLIENT_ID.includes('your_google') ? (
                  <>
                    <button
                      type="button"
                      onClick={() => googleLogin()}
                      className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-2xl border-2 border-slate-200 hover:border-slate-400 hover:bg-slate-50 transition-all font-bold text-slate-700 text-sm"
                    >
                      <svg width="18" height="18" viewBox="0 0 48 48">
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                      </svg>
                      Continue with Google
                    </button>
                    <p className="text-xs text-slate-400 text-center mt-2">
                      Google login enables sending emails from your account
                    </p>
                  </>
                ) : (
                  <div className="text-center text-xs text-slate-400 bg-slate-50 rounded-xl px-4 py-3 border border-slate-200">
                    <p className="font-semibold text-slate-500 mb-1">Google Sign-In not configured</p>
                    <p>Add <code className="bg-slate-100 px-1 rounded font-mono">VITE_GOOGLE_CLIENT_ID</code> to <code className="bg-slate-100 px-1 rounded font-mono">frontend/.env</code></p>
                  </div>
                )}
              </>
            ) : (
              <form onSubmit={handleRegister} className="space-y-4">
                <div><label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">User ID</label><input type="text" value={regId} onChange={e => setRegId(e.target.value)} placeholder="Choose a unique ID" className="input-field" /></div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Role</label>
                  <div className="flex gap-3">
                    {['student','teacher'].map(r => (
                      <button key={r} type="button" onClick={() => setRegRole(r)} className={`flex-1 py-2.5 rounded-xl text-sm font-bold border-2 transition-all capitalize ${regRole === r ? 'bg-[#0a1628] border-[#0a1628] text-white' : 'border-slate-200 text-slate-500 hover:border-slate-400'}`}>
                        {r === 'student' ? '🎓' : '📖'} {r}
                      </button>
                    ))}
                  </div>
                </div>
                <div><label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Password</label>
                  <div className="relative">
                    <input type={showRegPass ? 'text' : 'password'} value={regPass} onChange={e => setRegPass(e.target.value)} placeholder="Min. 6 characters" className="input-field pr-12" />
                    <button type="button" onClick={() => setShowRegPass(!showRegPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition">{showRegPass ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                  </div>
                </div>
                <div><label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Confirm Password</label><input type="password" value={regPass2} onChange={e => setRegPass2(e.target.value)} placeholder="Re-enter password" className="input-field" /></div>
                {regError && <p className="text-red-500 text-sm font-medium">{regError}</p>}
                {regSuccess && <p className="text-green-600 text-sm font-medium">{regSuccess}</p>}
                <button type="submit" disabled={regLoading} className="btn-navy w-full flex items-center justify-center gap-2 mt-2">
                  {regLoading ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><UserPlus size={18} /> Create Account</>}
                </button>
              </form>
            )}
          </div>
        </div>
        <p className="text-center text-blue-300/50 text-xs mt-6">© 2026 EduFlow · MNIT Jaipur</p>
      </div>
    </div>
  )
}
