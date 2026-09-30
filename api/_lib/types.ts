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

export type CapturedLead = {
  customer_name: string
  customer_phone: string
  service_requested: string
  preferred_time: string
  notes: string
}

export type AgentResult = {
  reply: string
  lead: CapturedLead | null
}

export type GreenApiSenderData = {
  chatId?: string
  sender?: string
  senderName?: string
  senderContactName?: string
  chatName?: string
}

export type GreenApiFileData = {
  downloadUrl?: string
  mimeType?: string
  fileName?: string
  caption?: string
}

export type GreenApiMessageData = {
  typeMessage?: string
  textMessageData?: { textMessage?: string }
  extendedTextMessageData?: { text?: string }
  fileMessageData?: GreenApiFileData
  quotedMessage?: { textMessage?: string }
}

export type GreenApiWebhook = {
  typeWebhook?: string
  instanceData?: {
    idInstance?: string | number
    wid?: string
    typeInstance?: string
  }
  timestamp?: number
  idMessage?: string
  senderData?: GreenApiSenderData
  messageData?: GreenApiMessageData
}
