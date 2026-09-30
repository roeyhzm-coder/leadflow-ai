import { MessageSquareText, Settings2, Workflow } from 'lucide-react'
import { cn } from '../lib/utils.ts'

type ViewId = 'leads' | 'settings'

type HeaderProps = {
  businessName: string
  sourceLabel: string
  view: ViewId
  onViewChange: (view: ViewId) => void
}

export function Header({ businessName, sourceLabel, view, onViewChange }: HeaderProps) {
  return (
    <header className="flex flex-col gap-4 border-b border-white/10 bg-[#10261f] px-4 py-4 text-white sm:flex-row sm:items-center sm:justify-between sm:px-8">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#25d366] text-[#10261f] shadow-lg shadow-emerald-900/40">
          <Workflow className="h-6 w-6" />
        </div>
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-emerald-200/80">
            LEADFLOW AI
          </p>
          <h1 className="text-lg font-bold leading-tight sm:text-xl">{businessName}</h1>
          <p className="text-xs text-emerald-100/70">מקור נתונים: {sourceLabel}</p>
        </div>
      </div>

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
    </header>
  )
}
