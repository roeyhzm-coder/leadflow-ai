import { useEffect, useMemo, useState } from 'react'
import { ConversationDrawer } from './components/ConversationDrawer.tsx'
import { Header } from './components/Header.tsx'
import { LeadsTable } from './components/LeadsTable.tsx'
import { StatsBar } from './components/StatsBar.tsx'
import { TenantSettings } from './components/TenantSettings.tsx'
import {
  loadDashboard,
  loadDashboardLocal,
  loadMessages,
  updateLeadStatus,
  updateTenantSettings,
  type DataSource,
} from './lib/api.ts'
import type { DashboardStats, Lead, LeadStatus, Message, Tenant, TenantSettingsPatch } from './lib/types.ts'

const SOURCE_LABELS: Record<DataSource, string> = {
  api: 'API / Vercel',
  supabase: 'Supabase ישיר',
  local: 'דמו מקומי',
}

const initialLocal = loadDashboardLocal()

function computeStats(leads: Lead[], activeConversations: number): DashboardStats {
  const converted = leads.filter((lead) => lead.status === 'converted').length
  const conversionRate = leads.length === 0 ? 0 : Math.round((converted / leads.length) * 100)
  return {
    totalLeads: leads.length,
    activeConversations,
    conversionRate,
  }
}

export default function App() {
  const [view, setView] = useState<'leads' | 'settings'>('leads')
  const [tenant, setTenant] = useState<Tenant>(initialLocal.tenant)
  const [leads, setLeads] = useState<Lead[]>(initialLocal.leads)
  const [activeConversations, setActiveConversations] = useState(
    initialLocal.conversations.filter((item) => item.status === 'active').length,
  )
  const [source, setSource] = useState<DataSource>(initialLocal.source)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadDashboard().then((payload) => {
      if (cancelled) return
      setTenant(payload.tenant)
      setLeads(payload.leads)
      setActiveConversations(
        payload.conversations.filter((item) => item.status === 'active').length,
      )
      setSource(payload.source)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const stats = useMemo(
    () => computeStats(leads, activeConversations),
    [leads, activeConversations],
  )

  async function handleStatusChange(id: string, status: LeadStatus): Promise<void> {
    setLeads((current) => current.map((lead) => (lead.id === id ? { ...lead, status } : lead)))
    const updated = await updateLeadStatus(id, status)
    if (updated) {
      setLeads((current) => current.map((lead) => (lead.id === updated.id ? updated : lead)))
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
    const history = await loadMessages(lead.conversation_id)
    setMessages(history)
    setMessagesLoading(false)
  }

  async function handleSaveSettings(patch: TenantSettingsPatch): Promise<void> {
    setSavingSettings(true)
    setSettingsSaved(false)
    const saved = await updateTenantSettings(tenant, patch)
    setTenant(saved)
    setSavingSettings(false)
    setSettingsSaved(true)
    window.setTimeout(() => setSettingsSaved(false), 2500)
  }

  return (
    <div className="min-h-dvh bg-[#f3f0e8]">
      <Header
        businessName={tenant.business_name}
        sourceLabel={SOURCE_LABELS[source]}
        view={view}
        onViewChange={setView}
      />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-8">
        {view === 'leads' ? (
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
            key={tenant.id + tenant.business_name}
            tenant={tenant}
            saving={savingSettings}
            saved={settingsSaved}
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
