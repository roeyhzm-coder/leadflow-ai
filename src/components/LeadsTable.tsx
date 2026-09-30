import { MessagesSquare } from 'lucide-react'
import { StatusBadge } from './StatusBadge.tsx'
import { LEAD_STATUSES, LEAD_STATUS_LABELS, formatDateTime, formatPhone } from '../lib/utils.ts'
import type { Lead, LeadStatus } from '../lib/types.ts'

type LeadsTableProps = {
  leads: Lead[]
  onStatusChange: (id: string, status: LeadStatus) => void
  onOpenConversation: (lead: Lead) => void
}

export function LeadsTable({ leads, onStatusChange, onOpenConversation }: LeadsTableProps) {
  if (leads.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-500">
        אין לידים עדיין. ברגע שלקוח ישלים הסמכה בוואטסאפ, הוא יופיע כאן.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full text-right text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">לקוח</th>
              <th className="px-4 py-3">טלפון</th>
              <th className="px-4 py-3">שירות</th>
              <th className="px-4 py-3">זמן מועדף</th>
              <th className="px-4 py-3">סטטוס</th>
              <th className="px-4 py-3">נוצר</th>
              <th className="px-4 py-3">פעולות</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {leads.map((lead) => (
              <tr key={lead.id} className="hover:bg-emerald-50/40">
                <td className="px-4 py-3 font-semibold text-slate-900">
                  {lead.customer_name || 'ללא שם'}
                </td>
                <td className="px-4 py-3 font-mono text-slate-700" dir="ltr">
                  {formatPhone(lead.customer_phone)}
                </td>
                <td className="max-w-[220px] px-4 py-3 text-slate-700">
                  {lead.service_requested || '—'}
                </td>
                <td className="px-4 py-3 text-slate-600">{lead.preferred_time || '—'}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={lead.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                  {formatDateTime(lead.created_at)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <select
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                      value={lead.status}
                      onChange={(event) =>
                        onStatusChange(lead.id, event.target.value as LeadStatus)
                      }
                    >
                      {LEAD_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {LEAD_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!lead.conversation_id}
                      onClick={() => onOpenConversation(lead)}
                      className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#10261f] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#16382d] disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      <MessagesSquare className="h-3.5 w-3.5" />
                      שיחה
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
