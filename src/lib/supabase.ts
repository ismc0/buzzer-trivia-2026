import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const configured = Boolean(url && key && !url.includes('YOUR_PROJECT') && !key.includes('YOUR_SUPABASE'))
export const supabase = createClient(url || 'https://example.supabase.co', key || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
})

export type Buzz = { id: string; participant_id: string; participant_name: string; position: number; created_at: string }
export type RoomState = { code: string; status: 'waiting' | 'active' | 'locked' | 'finished'; round_number: number; round_id: string | null; participant_count: number; buzzes: Buzz[] }
