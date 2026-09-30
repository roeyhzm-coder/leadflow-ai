export type ConversationStatus = 'active' | 'muted_by_human' | 'closed'
export type MessageSender = 'customer' | 'bot' | 'human'
export type MessageType = 'text' | 'audio'
export type LeadStatus = 'new' | 'in_progress' | 'converted' | 'dismissed'

export type Tenant = {
  id: string
  created_at: string
  business_name: string
  whatsapp_instance_id: string | null
  whatsapp_phone: string | null
  owner_phone: string | null
  system_prompt: string | null
  target_goal: string | null
  is_active: boolean
}

export type Conversation = {
  id: string
  created_at: string
  tenant_id: string
  customer_phone: string
  customer_name: string | null
  status: ConversationStatus
  muted_until: string | null
  last_message_at: string
}

export type Message = {
  id: string
  created_at: string
  conversation_id: string
  sender: MessageSender
  message_type: MessageType
  content: string
  raw_payload: unknown
}

export type Lead = {
  id: string
  created_at: string
  tenant_id: string
  conversation_id: string | null
  customer_name: string | null
  customer_phone: string | null
  service_requested: string | null
  preferred_time: string | null
  notes: string | null
  status: LeadStatus
}

export type DashboardStats = {
  totalLeads: number
  activeConversations: number
  conversionRate: number
}

export type TenantSettingsPatch = {
  business_name: string
  system_prompt: string
  owner_phone: string
  target_goal?: string
}
