import { createClient } from "@supabase/supabase-js";

export type ShelfName =
  | "wantToRead"
  | "currentlyReading"
  | "booksRead"
  | "goated";

const ANONYMOUS_SHELF_KEY = "booksrus-anonymous-shelf-key";
const CONFIGURED_ANONYMOUS_SHELF_KEY =
  process.env.NEXT_PUBLIC_SHELF_ANON_KEY?.trim() ?? "";
let supabaseClient: ReturnType<typeof createClient> | null = null;
let hasWarnedAboutMissingConfig = false;

export function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

export function getSupabaseAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
}

export function getSupabaseServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
}

export function getSupabaseClient() {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();

  if (!url || !anonKey) {
    if (!hasWarnedAboutMissingConfig && typeof window !== "undefined") {
      const missingVars = [
        !url ? "NEXT_PUBLIC_SUPABASE_URL" : null,
        !anonKey ? "NEXT_PUBLIC_SUPABASE_ANON_KEY" : null,
      ].filter((value): value is string => value !== null);

      console.warn(
        `[supabase] Missing public env vars: ${missingVars.join(", ")}. Shelf data sync is disabled.`,
      );
      hasWarnedAboutMissingConfig = true;
    }

    return null;
  }

  if (!supabaseClient) {
    supabaseClient = createClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }

  return supabaseClient;
}

export function getAnonymousShelfKey() {
  if (CONFIGURED_ANONYMOUS_SHELF_KEY.length > 0) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        ANONYMOUS_SHELF_KEY,
        CONFIGURED_ANONYMOUS_SHELF_KEY,
      );
    }

    return CONFIGURED_ANONYMOUS_SHELF_KEY;
  }

  if (typeof window === "undefined") {
    return "demo-local-user";
  }

  const stored = window.localStorage.getItem(ANONYMOUS_SHELF_KEY);
  if (stored && stored.trim().length > 0) {
    return stored;
  }

  const value =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `demo-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  window.localStorage.setItem(ANONYMOUS_SHELF_KEY, value);
  return value;
}
