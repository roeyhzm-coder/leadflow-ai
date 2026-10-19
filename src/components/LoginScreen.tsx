import { useEffect, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { KeyRound, LoaderCircle, Mail, Workflow } from 'lucide-react'
import { cn } from '../lib/utils.ts'

type LoginScreenProps = {
  supabase: SupabaseClient
}

type Mode = 'password' | 'magic'

/** Supabase limits OTP e-mails per address; mirror it so the button can't be spammed. */
const MAGIC_LINK_COOLDOWN_SECONDS = 60

function hebrewAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'אימייל או סיסמה שגויים.'
  if (/email not confirmed/i.test(message)) return 'יש לאשר את כתובת האימייל לפני הכניסה.'
  if (/rate limit|too many|security purposes/i.test(message)) return 'יותר מדי ניסיונות. נסו שוב בעוד דקה.'
  if (/signups not allowed|user not found/i.test(message)) return 'החשבון לא קיים. פנו למנהל המערכת לקבלת גישה.'
  return 'הכניסה נכשלה. נסו שוב.'
}

export function LoginScreen({ supabase }: LoginScreenProps) {
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [magicSentTo, setMagicSentTo] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (submitting || (mode === 'magic' && cooldown > 0)) return
    setSubmitting(true)
    setError(null)
    const address = email.trim()

    if (mode === 'password') {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: address, password })
      if (signInError) setError(hebrewAuthError(signInError.message))
      // On success onAuthStateChange in AuthGate swaps this screen for the dashboard.
    } else {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: address,
        // Accounts are provisioned by an admin; the login form never creates users.
        options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
      })
      if (otpError) {
        setError(hebrewAuthError(otpError.message))
      } else {
        setMagicSentTo(address)
        setCooldown(MAGIC_LINK_COOLDOWN_SECONDS)
      }
    }
    setSubmitting(false)
  }

  const inputClass =
    'w-full rounded-xl border border-slate-200 px-3 py-2.5 text-left text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100'

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#25d366] text-[#10261f] shadow-lg shadow-emerald-900/20">
            <Workflow className="h-6 w-6" />
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-[0.18em] text-emerald-700/80">LEADFLOW AI</p>
            <h1 className="text-xl font-bold text-slate-900">כניסה ללוח הלידים</h1>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div className="flex rounded-xl bg-slate-100 p-1" role="tablist">
            {(
              [
                { id: 'password', label: 'סיסמה', icon: KeyRound },
                { id: 'magic', label: 'קישור קסם', icon: Mail },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={mode === tab.id}
                onClick={() => {
                  setMode(tab.id)
                  setError(null)
                }}
                className={cn(
                  'inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition',
                  mode === tab.id ? 'bg-white text-[#10261f] shadow' : 'text-slate-600 hover:text-slate-900',
                )}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>

          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-slate-700">אימייל</span>
            <input
              type="email"
              required
              dir="ltr"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClass}
            />
          </label>

          {mode === 'password' ? (
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-slate-700">סיסמה</span>
              <input
                type="password"
                required
                dir="ltr"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={inputClass}
              />
            </label>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
          {mode === 'magic' && magicSentTo ? (
            <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              שלחנו קישור כניסה אל <span dir="ltr">{magicSentTo}</span>. פתחו אותו בדפדפן הזה.
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting || (mode === 'magic' && cooldown > 0)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#25d366] px-5 py-2.5 text-sm font-bold text-[#10261f] transition hover:bg-[#1fbe5a] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            {mode === 'password'
              ? 'כניסה'
              : cooldown > 0
                ? `שליחה חוזרת בעוד ${cooldown} שניות`
                : 'שליחת קישור כניסה'}
          </button>
        </form>

        <p className="text-center text-xs text-slate-500">הגישה ניתנת על ידי מנהל המערכת בלבד.</p>
      </div>
    </div>
  )
}
