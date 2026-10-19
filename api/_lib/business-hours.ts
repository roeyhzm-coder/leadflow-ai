import type { BusinessHours, Tenant } from './types.js'

export const DEFAULT_TIMEZONE = 'Asia/Jerusalem'

const HEBREW_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'] as const
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

/**
 * Validates tenants.business_hours. Returns null when it is missing or malformed,
 * which callers treat as "always open" so a bad config never silences the bot.
 */
export function parseBusinessHours(value: unknown): BusinessHours | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const open = typeof record.open === 'string' ? record.open.trim() : ''
  const close = typeof record.close === 'string' ? record.close.trim() : ''
  if (!TIME_PATTERN.test(open) || !TIME_PATTERN.test(close) || open === close) return null

  const days = Array.isArray(record.days)
    ? [...new Set(record.days.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))]
    : []
  if (days.length === 0) return null

  const timezone =
    typeof record.timezone === 'string' && isValidTimezone(record.timezone.trim())
      ? record.timezone.trim()
      : DEFAULT_TIMEZONE
  const nightMessage = typeof record.night_message === 'string' ? record.night_message.trim() : ''

  return {
    days: days.sort((a, b) => a - b),
    open,
    close,
    timezone,
    ...(nightMessage ? { night_message: nightMessage } : {}),
  }
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

/** Weekday (0 = Sunday) and minutes past midnight of `now` in `timezone`. */
export function localClock(now: Date, timezone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''
  return {
    day: WEEKDAY_INDEX[get('weekday')] ?? 0,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  }
}

/**
 * True when `now` falls inside the opening window. An overnight window
 * (close earlier than open, e.g. 20:00-02:00) belongs to the day it opens on.
 */
export function isWithinBusinessHours(hours: BusinessHours, now: Date = new Date()): boolean {
  const { day, minutes } = localClock(now, hours.timezone)
  const open = toMinutes(hours.open)
  const close = toMinutes(hours.close)

  if (open < close) {
    return hours.days.includes(day) && minutes >= open && minutes < close
  }
  const previousDay = (day + 6) % 7
  return (hours.days.includes(day) && minutes >= open) || (hours.days.includes(previousDay) && minutes < close)
}

/** Hebrew label of the next opening, e.g. "מחר ב-09:00" or "ביום ראשון ב-09:00". */
export function nextOpeningLabel(hours: BusinessHours, now: Date = new Date()): string {
  const { day, minutes } = localClock(now, hours.timezone)
  const open = toMinutes(hours.open)

  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = (day + offset) % 7
    if (!hours.days.includes(candidate)) continue
    if (offset === 0 && minutes >= open) continue
    if (offset === 0) return `היום ב-${hours.open}`
    if (offset === 1) return `מחר ב-${hours.open}`
    return `ביום ${HEBREW_DAYS[candidate]} ב-${hours.open}`
  }
  return `ב-${hours.open}`
}

export type BusinessHoursStatus =
  | { open: true }
  | { open: false; hours: BusinessHours; nextOpening: string }

/** Tenants without a valid business_hours config are treated as always open. */
export function businessHoursStatus(tenant: Tenant, now: Date = new Date()): BusinessHoursStatus {
  const hours = parseBusinessHours(tenant.business_hours)
  if (!hours || isWithinBusinessHours(hours, now)) return { open: true }
  return { open: false, hours, nextOpening: nextOpeningLabel(hours, now) }
}

/** The tenant's configured night greeting, or a default that asks for contact details. */
export function nightGreeting(tenant: Tenant, hours: BusinessHours, nextOpening: string): string {
  if (hours.night_message) return hours.night_message
  return `שלום, הגעתם ל-${tenant.business_name} 🌙 כרגע אנחנו מחוץ לשעות הפעילות והצוות יחזור לפעילות ${nextOpening}. השאירו כאן שם מלא, הטיפול שמעניין אתכם ומועד נוח - ונחזור אליכם ראשונים עם פתיחת היום.`
}
