import axios from 'axios';
import { config } from './config.js';

const api = axios.create({
  baseURL: `${config.zammadUrl}/api/v1`,
  timeout: 15000
});

function buildHeaders(sessionData = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (config.zammadAuthMode === 'token') {
    headers.Authorization = `Token token=${config.zammadToken}`;
  } else if (sessionData?.zammadCookie) {
    headers.Cookie = sessionData.zammadCookie;
  }
  return headers;
}

export async function zammadSignin(username, password) {
  const response = await axios.post(
    `${config.zammadUrl}/api/v1/signin`,
    { username, password },
    { validateStatus: () => true }
  );

  if (response.status >= 400) {
    throw new Error('Invalid Zammad credentials');
  }

  const cookieHeader = response.headers['set-cookie'] || [];
  const zammadCookie = cookieHeader.map((c) => c.split(';')[0]).join('; ');

  return {
    zammadCookie,
    profile: response.data
  };
}

export async function zammadGet(path, sessionData) {
  const { data } = await api.get(path, { headers: buildHeaders(sessionData) });
  return data;
}

export async function zammadPost(path, body, sessionData, headers = {}) {
  const { data } = await api.post(path, body, {
    headers: { ...buildHeaders(sessionData), ...headers }
  });
  return data;
}

export async function zammadPut(path, body, sessionData) {
  const { data } = await api.put(path, body, {
    headers: buildHeaders(sessionData)
  });
  return data;
}

export async function findPowerdnsGroupId(sessionData) {
  const groups = await zammadGet('/groups', sessionData);
  const group = groups.find((g) => g.name?.toLowerCase() === config.powerdnsGroupName.toLowerCase());
  if (!group) throw new Error(`Group not found: ${config.powerdnsGroupName}`);
  return group.id;
}

export function buildTicketQuery(view, groupId, userId, search = '') {
  const clauses = [`group_id:${groupId}`];

  if (view === 'my-open') {
    clauses.push(`owner_id:${userId}`);
    clauses.push('-state.name:"closed"');
  }
  if (view === 'unassigned') {
    clauses.push('owner_id:1');
    clauses.push('-state.name:"closed"');
  }
  if (view === 'waiting-customer') {
    clauses.push('(state.name:"pending reminder" OR state.name:"pending close" OR state.name:"waiting for customer")');
  }
  if (view === 'escalated') {
    clauses.push('(priority.name:"3 high" OR priority.name:"4 urgent")');
    clauses.push('-state.name:"closed"');
  }

  if (search) {
    const escaped = search.replace(/"/g, '');
    clauses.push(`(number:${escaped} OR title:"${escaped}")`);
  }

  return clauses.join(' AND ');
}

export function mapTicket(raw, users = {}, states = {}, priorities = {}) {
  return {
    id: raw.id,
    number: raw.number,
    title: raw.title,
    customer: users[raw.customer_id]?.fullname || `#${raw.customer_id ?? '-'}`,
    state: states[raw.state_id]?.name || `#${raw.state_id}`,
    priority: priorities[raw.priority_id]?.name || `#${raw.priority_id}`,
    owner: users[raw.owner_id]?.fullname || 'Unassigned',
    updated_at: raw.updated_at,
    group_id: raw.group_id,
    owner_id: raw.owner_id,
    state_id: raw.state_id,
    priority_id: raw.priority_id
  };
}
