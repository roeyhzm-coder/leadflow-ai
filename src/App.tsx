import { useCallback, useEffect, useMemo, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { ConversationDrawer } from './components/ConversationDrawer.tsx'
import { Header, type Account } from './components/Header.tsx'
import { LeadsTable } from './components/LeadsTable.tsx'
import { StatsBar } from './components/StatsBar.tsx'
import { TenantSettings } from './components/TenantSettings.tsx'
import { ApiError, type DashboardApi, type DashboardPayload, type DataSource } from './lib/api.ts'
import type { DashboardStats, Lead, LeadStatus, Message, TenantSettingsPatch } from './lib/types.ts'

const SOURCE_LABELS: Record<DataSource, string> = {
  api: 'API / Vercel',
  local: 'דמו מקומי',
}

type AppProps = {
  api: DashboardApi
  /** Null in local demo mode (Supabase not configured). */
  account: Account | null
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: DashboardPayload }
  | { status: 'no_tenant' }
  | { status: 'error'; message: string }

function computeStats(leads: Lead[], activeConversations: number): DashboardStats {
  const converted = leads.filter((lead) => lead.status === 'converted').length
  const conversionRate = leads.length === 0 ? 0 : Math.round((converted / leads.length) * 100)
  return {
    totalLeads: leads.length,
    activeConversations,
    conversionRate,
  }
}

function describeError(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) return 'אין לך הרשאה לפעולה הזו.'
  return 'משהו השתבש בטעינת הנתונים. נסו לרענן את הדף.'
}

export default function App({ api, account }: AppProps) {
  const [view, setView] = useState<'leads' | 'settings'>('leads')
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [tenantId, setTenantId] = useState<string | undefined>(undefined)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  /** An expired or revoked session ends up here: drop it and return to the login screen. */
  const handleFailure = useCallback(
    (error: unknown): string => {
      if (error instanceof ApiError && error.status === 401) account?.onSignOut()
      return describeError(error)
    },
    [account],
  )

  useEffect(() => {
    let cancelled = false
    api
      .load(tenantId)
      .then((data) => {
        if (cancelled) return
        setState(data ? { status: 'ready', data } : { status: 'no_tenant' })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: handleFailure(error) })
      })
    return () => {
      cancelled = true
    }
  }, [api, tenantId, handleFailure])

  const data = state.status === 'ready' ? state.data : null
  const leads = useMemo(() => data?.leads ?? [], [data])
  const stats = useMemo(
    () =>
      computeStats(
        leads,
        (data?.conversations ?? []).filter((item) => item.status === 'active').length,
      ),
    [leads, data],
  )

  function patchData(update: (current: DashboardPayload) => DashboardPayload): void {
    setState((current) => (current.status === 'ready' ? { ...current, data: update(current.data) } : current))
  }

  async function handleStatusChange(id: string, status: LeadStatus): Promise<void> {
    const previous = leads.find((lead) => lead.id === id)?.status
    patchData((current) => ({
      ...current,
      leads: current.leads.map((lead) => (lead.id === id ? { ...lead, status } : lead)),
    }))
    try {
      const updated = await api.updateLeadStatus(id, status)
      patchData((current) => ({
        ...current,
        leads: current.leads.map((lead) => (lead.id === updated.id ? updated : lead)),
      }))
    } catch (error) {
      handleFailure(error)
      if (previous) {
        patchData((current) => ({
          ...current,
          leads: current.leads.map((lead) => (lead.id === id ? { ...lead, status: previous } : lead)),
        }))
      }
    }
  }

  async function handleOpenConversation(lead: Lead): Promise<void> {
    setSelectedLead(lead)
    setDrawerOpen(true)
    if (!lead.conversation_id) {
      setMessages([])
      return
    }
    setMessagesLoading(true)
    try {
      setMessages(await api.loadMessages(lead.conversation_id))
    } catch (error) {
      handleFailure(error)
      setMessages([])
    } finally {
      setMessagesLoading(false)
    }
  }

  async function handleSaveSettings(patch: TenantSettingsPatch): Promise<void> {
    if (!data) return
    setSavingSettings(true)
    setSettingsSaved(false)
    setSettingsError(null)
    try {
      const saved = await api.updateTenantSettings(data.tenant, patch)
      patchData((current) => ({
        ...current,
        tenant: saved,
        tenants: current.tenants.map((item) => (item.id === saved.id ? saved : item)),
      }))
      setSettingsSaved(true)
      window.setTimeout(() => setSettingsSaved(false), 2500)
    } catch (error) {
      setSettingsError(error instanceof ApiError && error.status === 400 ? error.message : handleFailure(error))
    } finally {
      setSavingSettings(false)
    }
  }

  return (
    <div className="min-h-dvh bg-[#f3f0e8]">
      <Header
        businessName={data?.tenant.business_name ?? 'LeadFlow AI'}
        sourceLabel={data ? SOURCE_LABELS[data.source] : ''}
        view={view}
        onViewChange={setView}
        account={account}
        tenants={data?.tenants ?? []}
        tenantId={data?.tenant.id}
        onTenantChange={(id) => {
          setDrawerOpen(false)
          setState({ status: 'loading' })
          setTenantId(id)
        }}
      />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-8">
        {state.status === 'loading' ? (
          <div className="flex justify-center py-20" role="status" aria-label="טוען">
            <LoaderCircle className="h-6 w-6 animate-spin text-emerald-700" />
          </div>
        ) : state.status === 'no_tenant' ? (
          <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">החשבון עדיין לא משויך לעסק</h2>
            <p className="mt-2 text-sm text-slate-500">
              פנו למנהל המערכת כדי לקבל גישה ללוח הלידים של העסק שלכם.
            </p>
          </div>
        ) : state.status === 'error' ? (
          <div role="alert" className="mx-auto max-w-md rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-800">
            {state.message}
          </div>
        ) : view === 'leads' ? (
          <>
            <StatsBar stats={stats} />
            <LeadsTable
              leads={leads}
              onStatusChange={(id, status) => {
                void handleStatusChange(id, status)
              }}
              onOpenConversation={(lead) => {
                void handleOpenConversation(lead)
              }}
            />
          </>
        ) : (
          <TenantSettings
            key={state.data.tenant.id + state.data.tenant.business_name}
            tenant={state.data.tenant}
            readOnly={state.data.role === 'staff'}
            saving={savingSettings}
            saved={settingsSaved}
            error={settingsError}
            onSave={handleSaveSettings}
          />
        )}
      </main>
      <ConversationDrawer
        open={drawerOpen}
        lead={selectedLead}
        messages={messages}
        loading={messagesLoading}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  )
}
