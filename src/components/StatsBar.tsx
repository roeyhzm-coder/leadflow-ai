import { Percent, MessageCircle, Target } from 'lucide-react'
import type { DashboardStats } from '../lib/types.ts'

type StatsBarProps = {
  stats: DashboardStats
}

const CARDS = [
  {
    key: 'totalLeads' as const,
    label: 'סה״כ לידים',
    icon: Target,
    format: (value: number) => String(value),
    accent: 'from-emerald-500/15 to-transparent',
  },
  {
    key: 'activeConversations' as const,
    label: 'שיחות פעילות',
    icon: MessageCircle,
    format: (value: number) => String(value),
    accent: 'from-sky-500/15 to-transparent',
  },
  {
    key: 'conversionRate' as const,
    label: 'שיעור המרה',
    icon: Percent,
    format: (value: number) => `${value}%`,
    accent: 'from-amber-500/15 to-transparent',
  },
]

export function StatsBar({ stats }: StatsBarProps) {
  return (
    <section className="grid gap-3 sm:grid-cols-3">
      {CARDS.map((card) => {
        const Icon = card.icon
        return (
          <article
            key={card.key}
            className={`relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm bg-gradient-to-br ${card.accent}`}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">{card.label}</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
                  {card.format(stats[card.key])}
                </p>
              </div>
              <span className="rounded-xl bg-[#10261f] p-2.5 text-[#25d366]">
                <Icon className="h-5 w-5" />
              </span>
            </div>
          </article>
        )
      })}
    </section>
  )
}
