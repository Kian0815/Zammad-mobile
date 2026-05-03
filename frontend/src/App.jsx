import React, { useEffect, useMemo, useState } from 'react';
import { useSwipeable } from 'react-swipeable';
import { api } from './api';

const VIEWS = [
  { id: 'my-open', label: 'My Open' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'waiting-customer', label: 'Waiting Customer' },
  { id: 'escalated', label: 'Escalated / High' }
];

function Login({ onLogin, error }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  return (
    <div className="login-screen">
      <h1>PowerDNS Queue</h1>
      <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
      <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button onClick={() => onLogin(username, password)}>Login</button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function TicketCard({ ticket, onOpen }) {
  return (
    <button className="ticket-card" onClick={() => onOpen(ticket.id)}>
      <div className="row"><strong>#{ticket.number}</strong><span>{ticket.updated_at?.replace('T', ' ').slice(0, 16)}</span></div>
      <h3>{ticket.title}</h3>
      <p>Customer: {ticket.customer}</p>
      <p>State: {ticket.state}</p>
      <p>Priority: {ticket.priority}</p>
      <p>Owner: {ticket.owner}</p>
    </button>
  );
}

function TicketDetail({ id, meta, onClose }) {
  const [data, setData] = useState(null);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [files, setFiles] = useState([]);
  const [updateFields, setUpdateFields] = useState({ owner_id: '', state_id: '', priority_id: '' });

  const load = async () => {
    const response = await api.ticket(id);
    setData(response);
    setUpdateFields({
      owner_id: response.ticket.owner_id || '',
      state_id: response.ticket.state_id || '',
      priority_id: response.ticket.priority_id || ''
    });
  };

  useEffect(() => { load(); }, [id]);
  if (!data) return <div className="panel">Loading...</div>;

  const submitArticle = async () => {
    const form = new FormData();
    form.append('body', body);
    form.append('internal', String(internal));
    files.forEach((file) => form.append('attachments', file));
    await api.addArticle(id, form);
    setBody('');
    setFiles([]);
    await load();
  };

  const saveTicket = async () => {
    const toNumberOrUndefined = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    };

    await api.updateTicket(id, {
      owner_id: toNumberOrUndefined(updateFields.owner_id),
      state_id: toNumberOrUndefined(updateFields.state_id),
      priority_id: toNumberOrUndefined(updateFields.priority_id)
    });
    await load();
  };

  return (
    <div className="detail">
      <div className="row"><button onClick={onClose}>← Back</button><strong>#{data.ticket.number}</strong></div>
      <h2>{data.ticket.title}</h2>
      <div className="panel">
        <label>Owner</label>
        <select value={updateFields.owner_id} onChange={(e) => setUpdateFields({ ...updateFields, owner_id: e.target.value })}>
          {meta.owners.map((o) => <option key={o.id} value={o.id}>{o.fullname}</option>)}
        </select>
        <label>State</label>
        <select value={updateFields.state_id} onChange={(e) => setUpdateFields({ ...updateFields, state_id: e.target.value })}>
          {meta.states.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label>Priority</label>
        <select value={updateFields.priority_id} onChange={(e) => setUpdateFields({ ...updateFields, priority_id: e.target.value })}>
          {meta.priorities.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button onClick={saveTicket}>Save Ticket Changes</button>
      </div>

      <div className="thread">
        {data.articles.map((a) => (
          <div key={a.id} className={`article ${a.internal ? 'internal' : 'external'}`}>
            <div className="row"><strong>{a.from || a.sender}</strong><span>{a.created_at?.slice(0, 16).replace('T', ' ')}</span></div>
            <p>{a.body}</p>
            <small>{a.internal ? 'Internal Note' : 'Customer-visible'}</small>
          </div>
        ))}
      </div>

      <div className="panel">
        <textarea rows="5" placeholder="Write reply or internal note..." value={body} onChange={(e) => setBody(e.target.value)} />
        <label><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note</label>
        <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} />
        <button onClick={submitArticle} disabled={!body.trim()}>Send</button>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState(VIEWS[0].id);
  const [tickets, setTickets] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [meta, setMeta] = useState({ owners: [], states: [], priorities: [] });

  const viewIndex = useMemo(() => VIEWS.findIndex((v) => v.id === view), [view]);
  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => setView(VIEWS[Math.min(viewIndex + 1, VIEWS.length - 1)].id),
    onSwipedRight: () => setView(VIEWS[Math.max(viewIndex - 1, 0)].id)
  });

  async function loadTickets() {
    const data = await api.tickets(view, search);
    setTickets(data.tickets);
  }

  useEffect(() => {
    api.me().then(({ user: u }) => {
      setUser(u);
      api.meta().then(setMeta);
    }).catch(() => {});
  }, []);

  useEffect(() => { if (user) loadTickets(); }, [view, user]);

  if (!user) return <Login onLogin={async (u, p) => {
    try {
      const data = await api.login(u, p);
      setUser(data.user);
      const metaData = await api.meta();
      setMeta(metaData);
    } catch (e) { setError(e.message); }
  }} error={error} />;

  if (selected) {
    return <TicketDetail id={selected} meta={meta} onClose={() => { setSelected(null); loadTickets(); }} />;
  }

  return (
    <div className="app" {...swipeHandlers}>
      <header>
        <h1>PowerDNS Tickets</h1>
        <input placeholder="Search # or subject" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button onClick={loadTickets}>Search</button>
      </header>
      <nav>
        {VIEWS.map((v) => (
          <button key={v.id} className={v.id === view ? 'active' : ''} onClick={() => setView(v.id)}>{v.label}</button>
        ))}
      </nav>
      <main>
        {tickets.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} onOpen={setSelected} />)}
        {tickets.length === 0 && <p className="empty">No tickets</p>}
      </main>
    </div>
  );
}
