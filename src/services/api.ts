import type { AuthUser } from '../types/siga.ts';

const TOKEN_KEY = 'siga_saude_token';

export function getAuthToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string | null) {
  if (token) {
    sessionStorage.setItem(TOKEN_KEY, token);
  } else {
    sessionStorage.removeItem(TOKEN_KEY);
  }
}

export async function apiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, { ...options, headers });
  const text = await response.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!response.ok) {
    const errMsg = (data as { error?: string })?.error || `Erro HTTP ${response.status}`;
    throw new Error(errMsg);
  }
  return data as T;
}

/**
 * Camada de serviços preparada para futura migração para Supabase (@supabase/supabase-js).
 * Atualmente conectada à API Express + SQLite persistida no servidor.
 */
export const sigaApi = {
  login: (identifier: string, password: string) =>
    apiRequest<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    }),
  logout: () => apiRequest<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  me: () => apiRequest<{ user: AuthUser }>('/api/auth/me'),
  recoverPassword: (identifier: string) =>
    apiRequest<{ ok: boolean; message: string }>('/api/auth/recover-password', {
      method: 'POST',
      body: JSON.stringify({ identifier }),
    }),
  get: <T>(url: string) => apiRequest<T>(url),
  post: <T>(url: string, body: unknown) =>
    apiRequest<T>(url, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(url: string, body: unknown) =>
    apiRequest<T>(url, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(url: string, body: unknown) =>
    apiRequest<T>(url, { method: 'PATCH', body: JSON.stringify(body) }),
};
