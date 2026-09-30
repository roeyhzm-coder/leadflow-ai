import { Mic, X } from 'lucide-react'
import { formatPhone, formatTime } from '../lib/utils.ts'
import type { Lead, Message } from '../lib/types.ts'

type ConversationDrawerProps = {
  open: boolean
  lead: Lead | null
  messages: Message[]
  loading: boolean
  onClose: () => void
}

function bubbleClasses(sender: Message['sender']): string {
  if (sender === 'customer') {
    return 'mr-8 bg-white text-slate-800 ring-1 ring-slate-200'
  }
  if (sender === 'human') {
    return 'ml-8 bg-amber-100 text-amber-950'
  }
  return 'ml-8 bg-[#d9fdd3] text-slate-900'
}

function senderLabel(sender: Message['sender']): string {
  if (sender === 'customer') return 'לקוח'
  if (sender === 'human') return 'נציג'
  return 'בוט'
}

export function ConversationDrawer({
  open,
  lead,
  messages,
  loading,
  onClose,
}: ConversationDrawerProps) {
  if (!open || !lead) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        aria-label="סגירה"
        className="h-full flex-1 bg-slate-900/40"
        onClick={onClose}
      />
      <aside className="flex h-full w-full max-w-md flex-col bg-[#efeae2] shadow-2xl">
        <header className="flex items-start justify-between gap-3 bg-[#10261f] px-5 py-4 text-white">
          <div>
            <p className="text-xs text-emerald-200">שיחת וואטסאפ</p>
            <h2 className="text-lg font-bold">{lead.customer_name || 'לקוח'}</h2>
            <p className="font-mono text-sm text-emerald-100/80" dir="ltr">
              {formatPhone(lead.customer_phone)}
            </p>
            {lead.service_requested ? (
              <p className="mt-1 text-sm text-emerald-50/90">{lead.service_requested}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/10 p-2 hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {loading ? (
            <p className="py-10 text-center text-sm text-slate-500">טוען היסטוריית שיחה…</p>
          ) : messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">אין הודעות לשיחה הזו.</p>
          ) : (
            messages.map((message) => (
              <div key={message.id} className={`rounded-2xl px-3 py-2 shadow-sm ${bubbleClasses(message.sender)}`}>
                <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-semibold opacity-70">
                  <span>{senderLabel(message.sender)}</span>
                  <span>{formatTime(message.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {message.message_type === 'audio' ? (
                    <span className="inline-flex items-center gap-1">
                      <Mic className="h-3.5 w-3.5" />
                      {message.content}
                    </span>
                  ) : (
                    message.content
                  )}
                </p>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  )
}
