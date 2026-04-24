"use client"

import { createClient, SupabaseClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  if (typeof window !== "undefined") {
    console.error(
      "Supabase client: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY are not set. " +
        "Copy .env.local.example to .env.local and fill them in."
    )
  }
}

let _browser: SupabaseClient | null = null

/** Browser-side Supabase client (anon key). Safe to expose publicly. */
export function getSupabase(): SupabaseClient {
  if (_browser) return _browser
  _browser = createClient(url ?? "", anonKey ?? "", {
    realtime: { params: { eventsPerSecond: 10 } },
  })
  return _browser
}

export const BACKEND_BASE_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000"
