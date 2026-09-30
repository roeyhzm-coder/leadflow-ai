import { LEAD_STATUS_LABELS, cn } from '../lib/utils.ts'
import type { LeadStatus } from '../lib/types.ts'

const STYLES: Record<LeadStatus, string> = {
  new: 'bg-sky-50 text-sky-800 ring-sky-200',
  in_progress: 'bg-amber-50 text-amber-900 ring-amber-200',
  converted: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  dismissed: 'bg-slate-100 text-slate-600 ring-slate-200',
}

type StatusBadgeProps = {
  status: LeadStatus
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset',
        STYLES[status],
        className,
      )}
    >
      {LEAD_STATUS_LABELS[status]}
    </span>
  )
}
