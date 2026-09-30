import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { LeadStatus } from './types.ts'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatPhone(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '')
  if (!digits) return '—'
  if (digits.startsWith('972') && digits.length >= 12) {
    return `0${digits.slice(3, 5)}-${digits.slice(5, 8)}-${digits.slice(8)}`
  }
  if (digits.length === 10 && digits.startsWith('0')) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return value ?? digits
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'חדש',
  in_progress: 'בטיפול',
  converted: 'הומר',
  dismissed: 'נדחה',
}

export const LEAD_STATUSES: LeadStatus[] = [
  'new',
  'in_progress',
  'converted',
  'dismissed',
]
