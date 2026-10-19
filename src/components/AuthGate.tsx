import { useEffect, useMemo, useState } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { LoaderCircle } from 'lucide-react'
import App from '../App.tsx'
import { createLocalApi, createRemoteApi } from '../lib/api.ts'
import { getSupabase } from '../lib/supabase.ts'
import { LoginScreen } from './LoginScreen.tsx'

/**
 * Supabase configured: the dashboard requires a signed-in session and reads data
 * through /api with its access token. Not configured: local demo data, no sign-in.
 */
export function AuthGate() {
  const supabase = getSupabase()
  if (!supabase) return <DemoDashboard />
  return <AuthenticatedDashboard supabase={supabase} />
}

function DemoDashboard() {
  const api = useMemo(() => createLocalApi(), [])
  return <App api={api} account={null} />
}

function AuthenticatedDashboard({ supabase }: { supabase: SupabaseClient }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      setReady(true)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setReady(true)
    })
    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [supabase])

  // getSession returns the current token and refreshes it when it is about to expire.
  const api = useMemo(
    () => createRemoteApi(async () => (await supabase.auth.getSession()).data.session?.access_token ?? null),
    [supabase],
  )

  const userId = session?.user.id
  const email = session?.user.email ?? ''
  const account = useMemo(
    () => ({
      email,
      onSignOut: () => {
        void supabase.auth.signOut()
      },
    }),
    [supabase, email],
  )

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="טוען">
        <LoaderCircle className="h-6 w-6 animate-spin text-emerald-700" />
      </div>
    )
  }
  if (!session) return <LoginScreen supabase={supabase} />
  // Keyed by user so switching accounts never shows the previous user's data.
  return <App key={userId} api={api} account={account} />
}
