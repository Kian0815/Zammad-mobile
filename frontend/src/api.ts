import type {
  LookupsResponse,
  PushConfig,
  Session,
  TicketDetail,
  TicketViewsResponse,
} from './types';

const apiBase = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: 'include',
    ...init,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(payload.error || 'Request failed');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const api = {
  login(username: string, password: string, remember = false) {
    return request<Session>(`${apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, remember }),
    });
  },
  logout() {
    return request<void>(`${apiBase}/auth/logout`, { method: 'POST' });
  },
  session() {
    return request<Session>(`${apiBase}/auth/session`);
  },
  listTickets(search = '', queue = 'all', sort = 'updated') {
    const params = new URLSearchParams();
    if (search) {
      params.set('search', search);
    }
    if (queue) {
      params.set('queue', queue);
    }
    if (sort) {
      params.set('sort', sort);
    }
    const query = params.toString();
    const url = query ? `${apiBase}/tickets?${query}` : `${apiBase}/tickets`;
    return request<TicketViewsResponse>(url);
  },
  ticket(ticketId: number) {
    return request<TicketDetail>(`${apiBase}/tickets/${ticketId}`);
  },
  lookups() {
    return request<LookupsResponse>(`${apiBase}/lookups`);
  },
  pushConfig() {
    return request<PushConfig>(`${apiBase}/push/config`);
  },
  subscribePush(subscription: PushSubscriptionJSON) {
    return request<void>(`${apiBase}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription }),
    });
  },
  unsubscribePush(endpoint: string) {
    return request<void>(`${apiBase}/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });
  },
  updateTicket(ticketId: number, payload: { owner_id?: number; state?: string; priority?: string }) {
    return request(`${apiBase}/tickets/${ticketId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  addArticle(ticketId: number, formData: FormData) {
    return request(`${apiBase}/tickets/${ticketId}/articles`, {
      method: 'POST',
      body: formData,
    });
  },
  applyMacro(ticketId: number, macroKey: string) {
    return request(`${apiBase}/tickets/${ticketId}/macro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ macroKey }),
    });
  },
};
