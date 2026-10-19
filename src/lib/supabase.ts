import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const isConfigured = Boolean(url && anonKey && !url.includes('tu-proyecto'));
export const supabase = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder-anon-key', {
  auth: { storage: typeof window === 'undefined' ? undefined : window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export type Profile = { user_id: string; full_name: string; dni: string; email: string; active: boolean };
export type Game = { id: string; name: string; category: string; description: string; quantity: number; status: string; image_path?: string | null; available?: number };
export type Tournament = { id: string; name: string; game_id: string; starts_at: string; description: string; max_participants: number; status: string; games?: { name: string } };
export type Reservation = { id: string; game_id: string; starts_at: string; ends_at: string; status: string; games?: { name: string } };
export type Loan = { id: string; game_id: string; borrowed_at: string; due_at: string; returned_at: string | null; status: string; games?: { name: string } };
