import { createContext } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
// Reuse the authenticated root client. Private broadcasts only trigger API revalidation.
export const MarketplaceRealtimeContext = createContext<SupabaseClient | null>(null)
