import { useState, useRef, useEffect } from 'react'
import {
  ArrowLeft, LogOut, Send, Paperclip, Sparkles,
  FileText, X, BookOpen, HelpCircle, Loader2, Bot, User
} from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

// ─── IMPORTANT: Paste your Gemini API key from https://aistudio.google.com/ ──
const GEMINI_API_KEY = 'AIzaSyBkdt4sAL390gYoZO0wlSkQCVZ-o_mo8VQ';
// ─────────────────────────────────────────────────────────────────────────────

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

const SYSTEM_PROMPT = `You are EduFlow AI — a knowledgeable, friendly academic tutor for MNIT Jaipur students.
Your role:
- Explain complex engineering and academic concepts clearly, step by step.
- When given notes or text, summarize them into concise bullet points and highlight key terms in **bold**.
- When asked to generate a quiz, create exactly 5 multiple-choice questions (A/B/C/D) with the correct answer marked.
- Keep answers focused, structured, and exam-ready.
- Always be encouraging and supportive.
- Format all mathematical expressions using LaTeX: inline math with $...$ and block math with $$...$$.
- Use Markdown formatting: **bold** for key terms, \`code\` for variables/functions, tables where helpful, and numbered lists for steps.`

async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  let text = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    text += content.items.map(item => item.str).join(' ') + '\n'
  }
  return text.trim()
}

async function extractTextFromTxt(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsText(file)
  })
}

async function callGemini(messages) {
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `API error ${res.status}`)
  }

  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response received.'
}

// Renders Markdown + LaTeX using react-markdown, remark-math, rehype-katex
function MessageContent({ text, isUser }) {
  return (
    <div className={`prose prose-sm max-w-none leading-relaxed
      ${isUser
        ? 'prose-invert prose-p:text-white prose-strong:text-white prose-li:text-white prose-headings:text-white prose-code:text-blue-200'
        : 'prose-slate prose-code:bg-slate-100 prose-code:text-[#0a1628] prose-code:px-1 prose-code:rounded prose-pre:bg-slate-900 prose-pre:text-slate-100'
      }`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // Tables
          table: ({ node, ...props }) => (
            <div className="overflow-x-auto my-2">
              <table className="border-collapse text-xs w-full" {...props} />
            </div>
          ),
          th: ({ node, ...props }) => (
            <th className="border border-slate-300 px-2 py-1 bg-slate-100 font-bold text-left" {...props} />
          ),
          td: ({ node, ...props }) => (
            <td className="border border-slate-300 px-2 py-1" {...props} />
          ),
          // Code blocks
          code: ({ node, inline, className, children, ...props }) => {
            if (inline) {
              return <code className={`font-mono text-xs ${isUser ? 'bg-white/20 text-blue-100' : 'bg-slate-100 text-[#0a1628]'} px-1.5 py-0.5 rounded`} {...props}>{children}</code>
            }
            return (
              <pre className="bg-slate-900 text-slate-100 rounded-xl p-3 overflow-x-auto text-xs font-mono my-2">
                <code {...props}>{children}</code>
              </pre>
            )
          },
          // Blockquote
          blockquote: ({ node, ...props }) => (
            <blockquote className={`border-l-4 pl-3 my-2 italic ${isUser ? 'border-blue-300 text-blue-100' : 'border-slate-300 text-slate-500'}`} {...props} />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

export default function LearningMode({ userId, onBack, onLogout }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `Hello! I'm your **EduFlow AI Tutor** 🎓\n\nI can help you with:\n- **Summarize notes** — paste or upload your notes\n- **Explain concepts** — ask me anything academic\n- **Generate a quiz** — click the Quiz button to test yourself\n\nUpload a PDF or paste your notes to get started!`,
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [uploadedFile, setUploadedFile] = useState(null) // { name, text }
  const [pasteMode, setPasteMode] = useState(false)
  const [pastedNotes, setPastedNotes] = useState('')

  const fileInputRef = useRef()
  const bottomRef = useRef()
  const textareaRef = useRef()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const addMessage = (role, content) => {
    setMessages(prev => [...prev, { role, content }])
  }

  const sendToGemini = async (userMsg, historyOverride) => {
    const history = historyOverride || messages
    setLoading(true)
    try {
      const allMsgs = [...history, { role: 'user', content: userMsg }]
      const reply = await callGemini(allMsgs)
      addMessage('assistant', reply)
    } catch (err) {
      addMessage('assistant', `⚠️ Error: ${err.message}\n\nMake sure your Gemini API key is set correctly in \`LearningMode.jsx\`.`)
    } finally {
      setLoading(false)
      setLoadingMsg('')
    }
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    addMessage('user', text)
    await sendToGemini(text)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFileUpload = async (file) => {
    if (!file) return
    const name = file.name
    const ext = name.split('.').pop().toLowerCase()

    setLoadingMsg(`AI is reading your ${ext.toUpperCase()} file...`)
    setLoading(true)

    try {
      let text = ''
      if (ext === 'pdf') {
        text = await extractTextFromPDF(file)
      } else if (['txt', 'md'].includes(ext)) {
        text = await extractTextFromTxt(file)
      } else {
        throw new Error('Unsupported file type. Please upload a PDF or TXT file.')
      }

      if (!text || text.length < 20) throw new Error('Could not extract text from this file.')

      setUploadedFile({ name, text })
      setLoading(false)
      setLoadingMsg('')

      // Auto-summarize
      const userMsg = `I've uploaded a file called "${name}". Here is its content:\n\n${text.slice(0, 12000)}\n\nPlease summarize these notes into bullet points and highlight key terms.`
      addMessage('user', `📎 Uploaded: **${name}** — summarizing...`)
      setLoadingMsg('AI is reading your notes...')
      setLoading(true)
      await sendToGemini(userMsg, [...messages, { role: 'user', content: userMsg }])
    } catch (err) {
      setLoading(false)
      setLoadingMsg('')
      addMessage('assistant', `⚠️ File error: ${err.message}`)
    }
  }

  const handlePasteSubmit = async () => {
    if (!pastedNotes.trim()) return
    setPasteMode(false)
    const text = pastedNotes.trim()
    setPastedNotes('')
    setUploadedFile({ name: 'Pasted Notes', text })
    const userMsg = `Here are my notes:\n\n${text}\n\nPlease summarize these into bullet points and highlight key terms.`
    addMessage('user', `📝 Pasted notes — summarizing...`)
    setLoadingMsg('AI is reading your notes...')
    await sendToGemini(userMsg)
  }

  const handleGenerateQuiz = async () => {
    if (loading) return
    const context = uploadedFile
      ? `Based on this content:\n\n${uploadedFile.text.slice(0, 8000)}`
      : 'Based on our conversation so far'
    const userMsg = `${context}\n\nGenerate 5 multiple-choice questions (A/B/C/D) to test my knowledge. Mark the correct answer for each.`
    addMessage('user', '🧠 Generate a 5-question quiz from my material')
    setLoadingMsg('Generating quiz...')
    await sendToGemini(userMsg)
  }

  const handleClearFile = () => {
    setUploadedFile(null)
    addMessage('assistant', 'File context cleared. Ask me anything!')
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Nav */}
      <nav className="bg-[#0a1628] px-6 py-4 flex items-center justify-between shadow-lg shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-blue-300 hover:text-white transition">
            <ArrowLeft size={20} />
          </button>
          <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center">
            <Sparkles size={16} className="text-[#0a1628]" />
          </div>
          <div>
            <span className="text-white font-black">Learning Mode</span>
            <span className="text-blue-300 text-xs ml-2">AI Tutor · {userId}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Quiz button */}
          <button
            onClick={handleGenerateQuiz}
            disabled={loading}
            className="hidden sm:flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-white/10 border border-white/20 text-white hover:bg-white/20 transition disabled:opacity-50"
          >
            <HelpCircle size={14} /> Generate Quiz
          </button>
          <button onClick={onLogout} className="text-blue-300 hover:text-white transition text-sm flex items-center gap-1">
            <LogOut size={15} />
          </button>
        </div>
      </nav>

      {/* File context banner */}
      {uploadedFile && (
        <div className="bg-blue-50 border-b border-blue-200 px-6 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-blue-700">
            <FileText size={15} />
            <span className="font-semibold">{uploadedFile.name}</span>
            <span className="text-blue-400 text-xs">({Math.round(uploadedFile.text.length / 1000)}k chars loaded)</span>
          </div>
          <button onClick={handleClearFile} className="text-blue-400 hover:text-red-500 transition">
            <X size={15} />
          </button>
        </div>
      )}

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-4 py-6 max-w-3xl w-full mx-auto">
        <div className="space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              {/* Avatar */}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5
                ${msg.role === 'assistant' ? 'bg-[#0a1628]' : 'bg-slate-200'}`}>
                {msg.role === 'assistant'
                  ? <Bot size={16} className="text-white" />
                  : <User size={16} className="text-slate-600" />}
              </div>

              {/* Bubble */}
              <div className={`max-w-[80%] rounded-2xl px-4 py-3 shadow-sm
                ${msg.role === 'assistant'
                  ? 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'
                  : 'bg-[#0a1628] text-white rounded-tr-sm'}`}>
                <MessageContent text={msg.content} isUser={msg.role === 'user'} />
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {loading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-[#0a1628] flex items-center justify-center shrink-0">
                <Bot size={16} className="text-white" />
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm flex items-center gap-2">
                <Loader2 size={15} className="text-[#0a1628] animate-spin" />
                <span className="text-slate-500 text-sm">{loadingMsg || 'Thinking...'}</span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Paste notes panel */}
      {pasteMode && (
        <div className="border-t border-slate-200 bg-white px-4 py-4 max-w-3xl w-full mx-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold text-[#0a1628]">Paste your notes</span>
            <button onClick={() => setPasteMode(false)} className="text-slate-400 hover:text-slate-600">
              <X size={16} />
            </button>
          </div>
          <textarea
            value={pastedNotes}
            onChange={e => setPastedNotes(e.target.value)}
            placeholder="Paste your lecture notes, textbook content, or any text here..."
            rows={5}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#0a1628] focus:ring-2 focus:ring-[#0a1628]/10 resize-none transition"
          />
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => setPasteMode(false)} className="text-sm text-slate-400 hover:text-slate-600 px-3 py-1.5">Cancel</button>
            <button onClick={handlePasteSubmit} disabled={!pastedNotes.trim()}
              className="btn-navy text-sm py-2 px-4 flex items-center gap-1.5 disabled:opacity-50">
              <Sparkles size={14} /> Summarize
            </button>
          </div>
        </div>
      )}

      {/* Input bar */}
      <div className="border-t border-slate-200 bg-white px-4 py-4 shrink-0">
        <div className="max-w-3xl mx-auto">
          {/* Quick action buttons */}
          <div className="flex gap-2 mb-3 flex-wrap">
            <button
              onClick={() => setPasteMode(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-200 text-slate-600 hover:border-[#0a1628] hover:text-[#0a1628] transition bg-white"
            >
              <BookOpen size={12} /> Paste Notes
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-200 text-slate-600 hover:border-[#0a1628] hover:text-[#0a1628] transition bg-white"
            >
              <Paperclip size={12} /> Upload PDF / TXT
            </button>
            <button
              onClick={handleGenerateQuiz}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-200 text-slate-600 hover:border-purple-500 hover:text-purple-600 transition bg-white disabled:opacity-50 sm:hidden"
            >
              <HelpCircle size={12} /> Generate Quiz
            </button>
          </div>

          {/* Text input row */}
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask me anything — explain a concept, solve a problem..."
              rows={1}
              className="flex-1 border border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#0a1628] focus:ring-2 focus:ring-[#0a1628]/10 resize-none transition max-h-32 overflow-y-auto"
              style={{ minHeight: '48px' }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="w-12 h-12 rounded-2xl bg-[#0a1628] hover:bg-[#162444] text-white flex items-center justify-center transition disabled:opacity-40 shrink-0"
            >
              <Send size={18} />
            </button>
          </div>

          <p className="text-xs text-slate-400 mt-2 text-center">
            Powered by Gemini 1.5 Flash · MNIT Jaipur EduFlow
          </p>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.txt,.md"
        className="hidden"
        onChange={e => handleFileUpload(e.target.files[0])}
      />
    </div>
  )
}
