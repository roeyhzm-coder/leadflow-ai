/**
 * Upserts the demo dental clinic tenant into Supabase using the service role key.
 * Usage: npx tsx scripts/setup-tenant.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { DENTAL_CLINIC_GOAL, DENTAL_CLINIC_PROMPT } from '../api/_lib/prompts.js'

function loadEnv(filePath: string): void {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

loadEnv(resolve(process.cwd(), '.env'))
loadEnv(resolve(process.cwd(), '.env.local'))

const DEMO_TENANT = {
  business_name: 'דנטל קליניק',
  whatsapp_instance_id: '710722751571',
  system_prompt: DENTAL_CLINIC_PROMPT,
  target_goal: DENTAL_CLINIC_GOAL,
  is_active: true,
} as const

async function main(): Promise<void> {
  const url =
    process.env.SUPABASE_URL?.trim() ||
    process.env.VITE_SUPABASE_URL?.trim() ||
    ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || ''

  if (!url || !serviceKey) {
    throw new Error(
      'Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env',
    )
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: existing, error: lookupError } = await supabase
    .from('tenants')
    .select('id, business_name, whatsapp_instance_id, is_active')
    .eq('whatsapp_instance_id', DEMO_TENANT.whatsapp_instance_id)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Lookup failed: ${lookupError.message}`)
  }

  if (existing?.id) {
    const { data: updated, error: updateError } = await supabase
      .from('tenants')
      .update({
        business_name: DEMO_TENANT.business_name,
        system_prompt: DEMO_TENANT.system_prompt,
        target_goal: DEMO_TENANT.target_goal,
        is_active: DEMO_TENANT.is_active,
      })
      .eq('id', existing.id)
      .select('id, business_name, whatsapp_instance_id, system_prompt, target_goal, is_active, created_at')
      .single()

    if (updateError) {
      throw new Error(`Update failed: ${updateError.message}`)
    }

    console.log('Tenant updated successfully:')
    console.log(JSON.stringify(updated, null, 2))
    return
  }

  const { data: inserted, error: insertError } = await supabase
    .from('tenants')
    .insert({
      business_name: DEMO_TENANT.business_name,
      whatsapp_instance_id: DEMO_TENANT.whatsapp_instance_id,
      system_prompt: DEMO_TENANT.system_prompt,
      target_goal: DEMO_TENANT.target_goal,
      is_active: DEMO_TENANT.is_active,
    })
    .select('id, business_name, whatsapp_instance_id, system_prompt, target_goal, is_active, created_at')
    .single()

  if (insertError) {
    throw new Error(`Insert failed: ${insertError.message}`)
  }

  console.log('Tenant created successfully:')
  console.log(JSON.stringify(inserted, null, 2))
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
