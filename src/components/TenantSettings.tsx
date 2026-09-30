import { useEffect, useState, type FormEvent } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import { formatPhone } from '../lib/utils.ts'
import type { Tenant, TenantSettingsPatch } from '../lib/types.ts'

type TenantSettingsProps = {
  tenant: Tenant
  saving: boolean
  saved: boolean
  onSave: (patch: TenantSettingsPatch) => Promise<void>
}

export function TenantSettings({ tenant, saving, saved, onSave }: TenantSettingsProps) {
  const [businessName, setBusinessName] = useState(tenant.business_name)
  const [ownerPhone, setOwnerPhone] = useState(tenant.owner_phone ?? '')
  const [systemPrompt, setSystemPrompt] = useState(tenant.system_prompt ?? '')
  const [targetGoal, setTargetGoal] = useState(tenant.target_goal ?? '')

  useEffect(() => {
    setBusinessName(tenant.business_name)
    setOwnerPhone(tenant.owner_phone ?? '')
    setSystemPrompt(tenant.system_prompt ?? '')
    setTargetGoal(tenant.target_goal ?? '')
  }, [tenant])

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    await onSave({
      business_name: businessName.trim(),
      owner_phone: ownerPhone.trim(),
      system_prompt: systemPrompt,
      target_goal: targetGoal.trim(),
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto max-w-3xl space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div>
        <h2 className="text-xl font-bold text-slate-900">הגדרות העסק</h2>
        <p className="mt-1 text-sm text-slate-500">
          הפרומפט והטלפון להתראות שולטים בהתנהגות הסוכן בוואטסאפ.
        </p>
      </div>

      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-slate-700">שם העסק</span>
        <input
          required
          value={businessName}
          onChange={(event) => setBusinessName(event.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-slate-700">טלפון להתראות (בעלים)</span>
        <input
          dir="ltr"
          value={ownerPhone}
          onChange={(event) => setOwnerPhone(event.target.value)}
          placeholder="97250..."
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-left font-mono text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
        />
        <span className="text-xs text-slate-400">פורמט נוכחי: {formatPhone(ownerPhone)}</span>
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-slate-700">מטרת היעד</span>
        <input
          value={targetGoal}
          onChange={(event) => setTargetGoal(event.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-slate-700">פרומפט מערכת לסוכן</span>
        <textarea
          rows={12}
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-[inherit] text-sm leading-relaxed text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-[#25d366] px-5 py-2.5 text-sm font-bold text-[#10261f] transition hover:bg-[#1fbe5a] disabled:opacity-60"
        >
          {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          שמירת הגדרות
        </button>
        {saved ? <span className="text-sm font-medium text-emerald-700">נשמר</span> : null}
      </div>
    </form>
  )
}
