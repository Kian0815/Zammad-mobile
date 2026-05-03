const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  login: (username, password) => request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }),
  me: () => request('/api/auth/me'),
  meta: () => request('/api/meta'),
  tickets: (view, q) => request(`/api/tickets?view=${encodeURIComponent(view)}&q=${encodeURIComponent(q || '')}`),
  ticket: (id) => request(`/api/tickets/${id}`),
  updateTicket: (id, payload) => request(`/api/tickets/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  addArticle: (id, formData) => request(`/api/tickets/${id}/articles`, { method: 'POST', body: formData })
};
