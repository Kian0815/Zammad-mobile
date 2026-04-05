import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict, formatISO9075 } from 'date-fns';
import clsx from 'clsx';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api } from './api';
import type {
  LookupsResponse,
  OwnerOption,
  QueueOption,
  Session,
  TicketCard,
  TicketDetail,
  ViewKey,
  WorkflowMacroOption,
} from './types';

const VIEW_ORDER: ViewKey[] = ['myOpen', 'unassigned', 'waitingCustomer', 'escalated'];
const apiBase = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');

function formatDate(value: string) {
  return `${formatDistanceToNowStrict(new Date(value), { addSuffix: true })} · ${formatISO9075(new Date(value))}`;
}

function AppHeader({ session, onLogout }: { session: Session; onLogout: () => void }) {
  return (
    <>
      <header className="app-header">
        <div>
          <p className="eyebrow">PowerDNS Zammad Mobile</p>
          <h1>PowerDNS Ticket Desk</h1>
        </div>
        <button className="ghost-button" onClick={onLogout} type="button">
          Sign out {session.username}
        </button>
      </header>
      {session.readOnlyMode ? (
        <div className="read-only-banner">
          Read-only mode is enabled. You can browse live tickets, but replies and updates are blocked.
        </div>
      ) : null}
    </>
  );
}

function LoginScreen() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const loginMutation = useMutation({
    mutationFn: () => api.login(username, password),
    onSuccess: () => navigate('/', { replace: true }),
  });

  return (
    <main className="login-shell">
      <section className="login-card">
        <p className="eyebrow">Installable PWA</p>
        <h1>PowerDNS ticket desk</h1>
        <p className="muted">Login happens through the backend proxy, so the Zammad token stays server-side.</p>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            loginMutation.mutate();
          }}
        >
          <label className="field">
            <span>Username</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} required />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button className="primary-button" type="submit" disabled={loginMutation.isPending}>
            {loginMutation.isPending ? 'Signing in...' : 'Sign in'}
          </button>
          {loginMutation.error ? <p className="error-text">{loginMutation.error.message}</p> : null}
        </form>
      </section>
    </main>
  );
}

function TicketCardView({ ticket, onClick }: { ticket: TicketCard; onClick: () => void }) {
  return (
    <button className="ticket-card" onClick={onClick} type="button">
      <div className="ticket-card-head">
        <div className="ticket-card-meta">
          <span className="ticket-number">#{ticket.number}</span>
          <span className="ticket-queue-pill">{ticket.queue_label}</span>
        </div>
        <span className="ticket-time">{formatDate(ticket.updated_at)}</span>
      </div>
      <h3>{ticket.title}</h3>
      <dl className="ticket-grid">
        <div>
          <dt>Customer</dt>
          <dd>{ticket.customer}</dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>{ticket.owner}</dd>
        </div>
        <div>
          <dt>State</dt>
          <dd>{ticket.state}</dd>
        </div>
        <div>
          <dt>Priority</dt>
          <dd>{ticket.priority}</dd>
        </div>
      </dl>
    </button>
  );
}

function TicketComposer({
  ticket,
  lookups,
  readOnlyMode,
}: {
  ticket: TicketDetail;
  lookups: LookupsResponse;
  readOnlyMode: boolean;
}) {
  const queryClient = useQueryClient();
  const [articleType, setArticleType] = useState<'reply' | 'note'>('reply');
  const [subject, setSubject] = useState(ticket.title);
  const [body, setBody] = useState('');
  const [ownerId, setOwnerId] = useState(String(ticket.owner_id || lookups.defaultOwnerId));
  const [state, setState] = useState(ticket.state_name);
  const [priority, setPriority] = useState(ticket.priority_name);
  const [workflowMacro, setWorkflowMacro] = useState('');
  const [files, setFiles] = useState<FileList | null>(null);

  useEffect(() => {
    setSubject(ticket.title);
    setOwnerId(String(ticket.owner_id || lookups.defaultOwnerId));
    setState(ticket.state_name);
    setPriority(ticket.priority_name);
    setWorkflowMacro('');
  }, [ticket, lookups.defaultOwnerId]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (ownerId !== String(ticket.owner_id || '')) {
        await api.updateTicket(ticket.id, { owner_id: Number(ownerId) });
      }
      if (priority !== ticket.priority_name || (!workflowMacro && state !== ticket.state_name)) {
        await api.updateTicket(ticket.id, {
          priority,
          ...(workflowMacro ? {} : { state }),
        });
      }
      if (body.trim()) {
        const formData = new FormData();
        formData.append('articleType', articleType);
        formData.append('subject', subject);
        formData.append('body', body.replace(/\n/g, '<br/>'));
        Array.from(files || []).forEach((file) => formData.append('attachments', file));
        await api.addArticle(ticket.id, formData);
      }
      if (workflowMacro) {
        await api.applyMacro(ticket.id, workflowMacro);
      }
    },
    onSuccess: async () => {
      setBody('');
      setFiles(null);
      setWorkflowMacro('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] }),
        queryClient.invalidateQueries({ queryKey: ['tickets'] }),
      ]);
    },
  });

  return (
    <section className="composer">
      <div className="composer-header">
        <div>
          <p className="eyebrow">Update ticket</p>
          <h3>Reply, note, or route</h3>
          {readOnlyMode ? <p className="muted">Write actions are disabled by the backend safety switch.</p> : null}
        </div>
        <div className="toggle-row">
          <button
            type="button"
            className={clsx('toggle-button', articleType === 'reply' && 'toggle-button-active')}
            onClick={() => setArticleType('reply')}
            disabled={readOnlyMode}
          >
            Reply
          </button>
          <button
            type="button"
            className={clsx('toggle-button', articleType === 'note' && 'toggle-button-active')}
            onClick={() => setArticleType('note')}
            disabled={readOnlyMode}
          >
            Internal note
          </button>
        </div>
      </div>

      <div className="composer-grid">
        <label className="field">
          <span>Owner</span>
          <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} disabled={readOnlyMode}>
            {lookups.owners.map((owner: OwnerOption) => (
              <option key={owner.id} value={owner.id}>
                {owner.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>State</span>
          <select value={state} onChange={(event) => setState(event.target.value)} disabled={readOnlyMode}>
            {lookups.states.map((entry) => (
              <option key={entry.id} value={entry.name}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Priority</span>
          <select value={priority} onChange={(event) => setPriority(event.target.value)} disabled={readOnlyMode}>
            {lookups.priorities.map((entry) => (
              <option key={entry.id} value={entry.name}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Next status via macro</span>
          <select value={workflowMacro} onChange={(event) => setWorkflowMacro(event.target.value)} disabled={readOnlyMode}>
            <option value="">No macro</option>
            {lookups.workflowMacros.map((entry: WorkflowMacroOption) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span>Subject</span>
        <input value={subject} onChange={(event) => setSubject(event.target.value)} disabled={readOnlyMode} />
      </label>

      <label className="field">
        <span>Message</span>
        <textarea
          rows={6}
          placeholder={articleType === 'reply' ? 'Reply to the customer...' : 'Leave an internal note...'}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          disabled={readOnlyMode}
        />
      </label>

      <label className="field">
        <span>Attachments</span>
        <input type="file" multiple onChange={(event) => setFiles(event.target.files)} disabled={readOnlyMode} />
      </label>

      <button
        className="primary-button"
        type="button"
        onClick={() => mutation.mutate()}
        disabled={readOnlyMode || mutation.isPending}
      >
        {readOnlyMode ? 'Read-only mode enabled' : mutation.isPending ? 'Saving...' : 'Save changes'}
      </button>
      {mutation.error ? <p className="error-text">{mutation.error.message}</p> : null}
    </section>
  );
}

function TicketThread({ ticket }: { ticket: TicketDetail }) {
  return (
    <section className="thread">
      <div className="detail-card">
        <p className="eyebrow">Ticket #{ticket.number}</p>
        <h2>{ticket.title}</h2>
        <dl className="ticket-grid">
          <div>
            <dt>Customer</dt>
            <dd>{ticket.customer?.fullname || ticket.customer?.email || 'Unknown customer'}</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>{ticket.owner?.fullname || ticket.owner?.email || 'Unassigned'}</dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>{ticket.state_name}</dd>
          </div>
          <div>
            <dt>Priority</dt>
            <dd>{ticket.priority_name}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatDate(ticket.updated_at)}</dd>
          </div>
        </dl>
      </div>

      <div className="timeline">
        {ticket.articles.map((article) => (
          <article
            key={article.id}
            className={clsx('timeline-item', article.internal ? 'timeline-item-internal' : 'timeline-item-external')}
          >
            <div className="timeline-meta">
              <span>{article.internal ? 'Internal note' : 'Customer-visible reply'}</span>
              <span>{article.created_by_user?.fullname || article.created_by_user?.email || article.created_by}</span>
              <span>{formatDate(article.created_at)}</span>
            </div>
            <h3>{article.subject || article.type}</h3>
            <div className="article-body" dangerouslySetInnerHTML={{ __html: article.body }} />
            {article.attachments.length > 0 ? (
              <div className="attachments">
                {article.attachments.map((attachment) => (
                  <a
                    key={attachment.id}
                    className="attachment-pill"
                    href={`${apiBase}/tickets/${ticket.id}/attachments/${article.id}/${attachment.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {attachment.filename}
                  </a>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function DashboardPage({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [activeView, setActiveView] = useState<ViewKey>('myOpen');
  const [activeQueue, setActiveQueue] = useState('all');
  const [sortBy, setSortBy] = useState<'updated' | 'queue'>('queue');
  const gestureStartX = useRef<number | null>(null);

  const lookupsQuery = useQuery({
    queryKey: ['lookups'],
    queryFn: api.lookups,
  });

  const ticketsQuery = useQuery({
    queryKey: ['tickets', search, activeQueue, sortBy],
    queryFn: () => api.listTickets(search, activeQueue, sortBy),
  });

  const views = ticketsQuery.data?.views;
  const currentTickets = views?.[activeView]?.tickets || [];

  const summary = useMemo(() => {
    if (!views) {
      return [];
    }

    return VIEW_ORDER.map((key) => views[key]);
  }, [views]);

  return (
    <main className="app-shell">
      <AppHeader session={session} onLogout={onLogout} />
      <section className="toolbar">
        <label className="search-field">
          <span>Search</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ticket number or subject"
          />
        </label>
        <div className="filters-row">
          <label className="field compact-field">
            <span>Queue</span>
            <select value={activeQueue} onChange={(event) => setActiveQueue(event.target.value)}>
              {(lookupsQuery.data?.queues || []).map((queue: QueueOption) => (
                <option key={queue.key} value={queue.key}>
                  {queue.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field compact-field">
            <span>Sort</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as 'updated' | 'queue')}>
              <option value="queue">Queue assignment</option>
              <option value="updated">Last updated</option>
            </select>
          </label>
        </div>
        <p className="muted">Swipe left or right across the ticket list to switch views.</p>
      </section>

      <div className="view-tabs">
        {summary.map((view) => (
          <button
            key={view.key}
            type="button"
            className={clsx('view-tab', activeView === view.key && 'view-tab-active')}
            onClick={() => setActiveView(view.key)}
          >
            <span>{view.label}</span>
            <strong>{view.tickets.length}</strong>
          </button>
        ))}
      </div>

      <section
        className="ticket-list"
        onTouchStart={(event) => {
          gestureStartX.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          if (gestureStartX.current === null) {
            return;
          }

          const endX = event.changedTouches[0]?.clientX ?? gestureStartX.current;
          const delta = endX - gestureStartX.current;
          const index = VIEW_ORDER.indexOf(activeView);

          if (delta < -50 && index < VIEW_ORDER.length - 1) {
            setActiveView(VIEW_ORDER[index + 1]);
          } else if (delta > 50 && index > 0) {
            setActiveView(VIEW_ORDER[index - 1]);
          }

          gestureStartX.current = null;
        }}
      >
        {ticketsQuery.isLoading ? <div className="empty-state">Loading tickets...</div> : null}
        {ticketsQuery.error ? <div className="empty-state">{ticketsQuery.error.message}</div> : null}
        {!ticketsQuery.isLoading && !ticketsQuery.error && currentTickets.length === 0 ? (
          <div className="empty-state">No tickets matched this view.</div>
        ) : null}
        {currentTickets.map((ticket) => (
          <TicketCardView key={ticket.id} ticket={ticket} onClick={() => navigate(`/tickets/${ticket.id}`)} />
        ))}
      </section>
    </main>
  );
}

function TicketDetailPage({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const params = useParams();
  const navigate = useNavigate();
  const ticketId = Number(params.ticketId);

  const detailQuery = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => api.ticket(ticketId),
  });
  const lookupsQuery = useQuery({
    queryKey: ['lookups'],
    queryFn: api.lookups,
  });

  if (detailQuery.isLoading || lookupsQuery.isLoading) {
    return (
      <main className="app-shell">
        <AppHeader session={session} onLogout={onLogout} />
        <div className="empty-state">Loading ticket...</div>
      </main>
    );
  }

  if (detailQuery.error || lookupsQuery.error || !detailQuery.data || !lookupsQuery.data) {
    return (
      <main className="app-shell">
        <AppHeader session={session} onLogout={onLogout} />
        <div className="empty-state">{detailQuery.error?.message || lookupsQuery.error?.message || 'Ticket not found'}</div>
      </main>
    );
  }

  return (
    <main className="app-shell detail-shell">
      <AppHeader session={session} onLogout={onLogout} />
      <button className="ghost-button" type="button" onClick={() => navigate(-1)}>
        Back to queues
      </button>
      <TicketThread ticket={detailQuery.data} />
      <TicketComposer ticket={detailQuery.data} lookups={lookupsQuery.data} readOnlyMode={session.readOnlyMode} />
    </main>
  );
}

function ProtectedRoutes() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ['session'],
    queryFn: api.session,
    retry: false,
  });

  const logoutMutation = useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      queryClient.clear();
      navigate('/login', { replace: true });
    },
  });

  if (sessionQuery.isLoading) {
    return (
      <main className="login-shell">
        <div className="empty-state">Checking session...</div>
      </main>
    );
  }

  if (sessionQuery.isError || !sessionQuery.data) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Routes>
      <Route path="/" element={<DashboardPage session={sessionQuery.data} onLogout={() => logoutMutation.mutate()} />} />
      <Route
        path="/tickets/:ticketId"
        element={<TicketDetailPage session={sessionQuery.data} onLogout={() => logoutMutation.mutate()} />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/*" element={<ProtectedRoutes />} />
    </Routes>
  );
}
