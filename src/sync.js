const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const SESSION_KEY = "life-os-cloud-session-v1";
const META_KEY = "life-os-cloud-meta-v1";

export const cloudConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

function loadJson(key, fallback = null) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}
function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
export function getCloudSession() {
  return loadJson(SESSION_KEY);
}
export function getCloudMeta() {
  return loadJson(META_KEY, { status: cloudConfigured ? "ready" : "unconfigured", lastSyncedAt: null, error: null });
}
function setCloudMeta(patch) {
  const next = { ...getCloudMeta(), ...patch };
  saveJson(META_KEY, next);
  window.dispatchEvent(new CustomEvent("life-os-sync-status", { detail: next }));
  return next;
}
function authHeaders(token) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}
async function jsonRequest(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const message = body?.msg || body?.message || body?.error_description || body?.error || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return body;
}
export async function signIn(email, password) {
  if (!cloudConfigured) throw new Error("云同步尚未配置");
  const session = await jsonRequest(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  saveJson(SESSION_KEY, session);
  setCloudMeta({ status: "signed-in", error: null });
  return session;
}
export async function signUp(email, password) {
  if (!cloudConfigured) throw new Error("云同步尚未配置");
  const result = await jsonRequest(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (result?.access_token) saveJson(SESSION_KEY, result);
  return result;
}
export function signOut() {
  localStorage.removeItem(SESSION_KEY);
  setCloudMeta({ status: cloudConfigured ? "ready" : "unconfigured", lastSyncedAt: null, error: null });
}
async function refreshSessionIfNeeded() {
  const session = getCloudSession();
  if (!session?.access_token) return null;
  if (!session.expires_at || session.expires_at * 1000 > Date.now() + 60000) return session;
  if (!session.refresh_token) return null;
  try {
    const next = await jsonRequest(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    saveJson(SESSION_KEY, next);
    return next;
  } catch {
    signOut();
    return null;
  }
}
function userId(session) {
  return session?.user?.id || null;
}
export async function pullCloudSnapshot() {
  if (!cloudConfigured) return null;
  const session = await refreshSessionIfNeeded();
  const uid = userId(session);
  if (!session?.access_token || !uid) return null;
  setCloudMeta({ status: "syncing", error: null });
  try {
    const rows = await jsonRequest(`${SUPABASE_URL}/rest/v1/life_os_state?user_id=eq.${encodeURIComponent(uid)}&select=payload,updated_at&limit=1`, {
      headers: authHeaders(session.access_token)
    });
    const row = Array.isArray(rows) ? rows[0] : null;
    setCloudMeta({ status: "synced", lastSyncedAt: row?.updated_at || new Date().toISOString(), error: null });
    return row || null;
  } catch (error) {
    setCloudMeta({ status: "error", error: error.message });
    throw error;
  }
}
export async function pushCloudSnapshot(payload) {
  if (!cloudConfigured) return false;
  const session = await refreshSessionIfNeeded();
  const uid = userId(session);
  if (!session?.access_token || !uid) return false;
  setCloudMeta({ status: "syncing", error: null });
  try {
    const updatedAt = new Date().toISOString();
    await jsonRequest(`${SUPABASE_URL}/rest/v1/life_os_state?on_conflict=user_id`, {
      method: "POST",
      headers: {
        ...authHeaders(session.access_token),
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({ user_id: uid, payload, updated_at: updatedAt })
    });
    setCloudMeta({ status: "synced", lastSyncedAt: updatedAt, error: null });
    return true;
  } catch (error) {
    setCloudMeta({ status: "error", error: error.message });
    throw error;
  }
}
