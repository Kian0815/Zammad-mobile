import type {
  LookupsResponse,
  Session,
  TicketDetail,
  TicketViewsResponse,
} from './types';

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
  login(username: string, password: string) {
    return request<Session>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  },
  logout() {
    return request<void>('/api/auth/logout', { method: 'POST' });
  },
  session() {
    return request<Session>('/api/auth/session');
  },
  listTickets(search = '') {
    const url = search ? `/api/tickets?search=${encodeURIComponent(search)}` : '/api/tickets';
    return request<TicketViewsResponse>(url);
  },
  ticket(ticketId: number) {
    return request<TicketDetail>(`/api/tickets/${ticketId}`);
  },
  lookups() {
    return request<LookupsResponse>('/api/lookups');
  },
  updateTicket(ticketId: number, payload: { owner_id?: number; state?: string; priority?: string }) {
    return request(`/api/tickets/${ticketId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  addArticle(ticketId: number, formData: FormData) {
    return request(`/api/tickets/${ticketId}/articles`, {
      method: 'POST',
      body: formData,
    });
  },
};
