import { LogOut, MessageSquareText, Settings2, Workflow } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import type { Tenant } from '../lib/types.ts'

type ViewId = 'leads' | 'settings'

export type Account = {
  email: string
  onSignOut: () => void
}

type HeaderProps = {
  businessName: string
  sourceLabel: string
  view: ViewId
  onViewChange: (view: ViewId) => void
  account: Account | null
  tenants: Tenant[]
  tenantId: string | undefined
  onTenantChange: (tenantId: string) => void
}

export function Header({
  businessName,
  sourceLabel,
  view,
  onViewChange,
  account,
  tenants,
  tenantId,
  onTenantChange,
}: HeaderProps) {
  return (
    <header className="flex flex-col gap-4 border-b border-white/10 bg-[#10261f] px-4 py-4 text-white sm:flex-row sm:items-center sm:justify-between sm:px-8">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#25d366] text-[#10261f] shadow-lg shadow-emerald-900/40">
          <Workflow className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-emerald-200/80">
            LEADFLOW AI
          </p>
          {tenants.length > 1 ? (
            <select
              aria-label="בחירת עסק"
              value={tenantId}
              onChange={(event) => onTenantChange(event.target.value)}
              className="max-w-full truncate rounded-lg bg-white/10 px-2 py-1 text-lg font-bold leading-tight text-white outline-none focus:ring-2 focus:ring-emerald-300 sm:text-xl"
            >
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id} className="text-slate-900">
                  {tenant.business_name}
                </option>
              ))}
            </select>
          ) : (
            <h1 className="truncate text-lg font-bold leading-tight sm:text-xl">{businessName}</h1>
          )}
          {sourceLabel ? <p className="text-xs text-emerald-100/70">מקור נתונים: {sourceLabel}</p> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <nav className="flex rounded-xl bg-white/10 p-1">
          <button
            type="button"
            onClick={() => onViewChange('leads')}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition',
              view === 'leads' ? 'bg-white text-[#10261f] shadow' : 'text-emerald-50 hover:bg-white/10',
            )}
          >
            <MessageSquareText className="h-4 w-4" />
            לידים
          </button>
          <button
            type="button"
            onClick={() => onViewChange('settings')}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition',
              view === 'settings' ? 'bg-white text-[#10261f] shadow' : 'text-emerald-50 hover:bg-white/10',
            )}
          >
            <Settings2 className="h-4 w-4" />
            הגדרות
          </button>
        </nav>

        {account ? (
          <div className="flex items-center gap-2">
            <span dir="ltr" className="hidden max-w-[14rem] truncate text-xs text-emerald-100/80 md:inline">
              {account.email}
            </span>
            <button
              type="button"
              onClick={account.onSignOut}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-emerald-50 transition hover:bg-white/10"
            >
              <LogOut className="h-4 w-4" />
              יציאה
            </button>
          </div>
        ) : null}
      </div>
    </header>
  )
}
