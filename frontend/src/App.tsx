import { Fragment, memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict, formatISO9075 } from 'date-fns';
import clsx from 'clsx';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api } from './api';
import type {
  LookupsResponse,
  OwnerOption,
  PushConfig,
  QueueOption,
  Session,
  TicketCard,
  TicketDetail,
  ViewKey,
  WorkflowMacroOption,
} from './types';

const VIEW_ORDER: ViewKey[] = ['allActive', 'myAssigned', 'newTickets', 'openTickets', 'waitingCustomer', 'pendingAutoclose', 'processing'];
const apiBase = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');
const AUTO_REFRESH_SECONDS = Math.max(Number(import.meta.env.VITE_AUTO_REFRESH_SECONDS || 10), 5);
const AUTO_REFRESH_MS = AUTO_REFRESH_SECONDS * 1000;
const AUTO_REFRESH_LABEL = AUTO_REFRESH_SECONDS % 60 === 0
  ? `${AUTO_REFRESH_SECONDS / 60}m`
  : `${AUTO_REFRESH_SECONDS}s`;
const PREFERENCE_KEY = 'zammad-mobile-dashboard';
const THEME_KEY = 'zammad-mobile-theme';

type SortKey = 'updated' | 'queue';
type ThemeMode = 'dark' | 'light';
type SlaEntry = {
  key: 'firstResponse' | 'restoration' | 'resolution';
  label: string;
  dueAt: string;
  breached: boolean;
  imminent: boolean;
  remainingLabel: string;
};
type DashboardPreferences = {
  view?: ViewKey;
  queue?: string;
  sort?: SortKey;
};

function formatDate(value: string) {
  return `${formatDistanceToNowStrict(new Date(value), { addSuffix: true })} · ${formatISO9075(new Date(value))}`;
}

function formatSlaRemaining(value: string, now = Date.now()) {
  const target = new Date(value).getTime();
  if (!Number.isFinite(target)) {
    return null;
  }

  const diffMs = target - now;
  const absMinutes = Math.max(1, Math.round(Math.abs(diffMs) / 60000));
  const days = Math.floor(absMinutes / (60 * 24));
  const hours = Math.floor((absMinutes % (60 * 24)) / 60);
  const minutes = absMinutes % 60;
  const parts = [
    days > 0 ? `${days}d` : null,
    hours > 0 ? `${hours}h` : null,
    minutes > 0 ? `${minutes}m` : null,
  ].filter(Boolean);
  const compact = parts.slice(0, 2).join(' ') || '1m';

  return {
    breached: diffMs <= 0,
    imminent: diffMs > 0 && diffMs <= 60 * 60 * 1000,
    label: diffMs <= 0 ? `${compact} overdue` : `${compact} left`,
  };
}

function getSlaEntries(ticket: Pick<TicketCard, 'first_response_escalation_at' | 'update_escalation_at' | 'close_escalation_at'>, now = Date.now()): SlaEntry[] {
  const candidates = [
    { key: 'firstResponse' as const, label: 'First response', dueAt: ticket.first_response_escalation_at },
    { key: 'restoration' as const, label: 'Restoration', dueAt: ticket.update_escalation_at },
    { key: 'resolution' as const, label: 'Resolution', dueAt: ticket.close_escalation_at },
  ];

  return candidates
    .map((entry) => {
      if (!entry.dueAt) {
        return null;
      }

      const timing = formatSlaRemaining(entry.dueAt, now);
      if (!timing) {
        return null;
      }

      return {
        key: entry.key,
        label: entry.label,
        dueAt: entry.dueAt,
        breached: timing.breached,
        imminent: timing.imminent,
        remainingLabel: timing.label,
      };
    })
    .filter((entry): entry is SlaEntry => Boolean(entry))
    .sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime());
}

function SlaPanel({
  ticket,
  compact = false,
  now,
}: {
  ticket: Pick<TicketCard, 'sla_customer' | 'first_response_escalation_at' | 'update_escalation_at' | 'close_escalation_at'>;
  compact?: boolean;
  now: number;
}) {
  const entries = getSlaEntries(ticket, now);
  if (!ticket.sla_customer && entries.length === 0) {
    return null;
  }

  const activeEntry = entries.find((entry) => entry.breached) || entries[0] || null;

  if (compact) {
    return (
      <div className="sla-strip">
        {ticket.sla_customer ? <span className="sla-profile-pill">{ticket.sla_customer}</span> : null}
        {activeEntry ? (
          <span
            className={clsx(
              'sla-pill',
              activeEntry.breached && 'sla-pill-breached',
              !activeEntry.breached && activeEntry.imminent && 'sla-pill-imminent',
            )}
          >
            {activeEntry.label}: {activeEntry.remainingLabel}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <section className="sla-panel">
      <div className="sla-panel-header">
        <div>
          <p className="eyebrow">SLA</p>
          <h3>{ticket.sla_customer || 'Active deadlines'}</h3>
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="muted">No live SLA deadlines are currently exposed by Zammad for this ticket.</p>
      ) : (
        <div className="sla-list">
          {entries.map((entry) => (
            <article
              key={entry.key}
              className={clsx(
                'sla-item',
                entry.breached && 'sla-item-breached',
                !entry.breached && entry.imminent && 'sla-item-imminent',
              )}
            >
              <div>
                <strong>{entry.label}</strong>
                <p className="muted">{formatISO9075(new Date(entry.dueAt))}</p>
              </div>
              <span className="sla-timer">{entry.remainingLabel}</span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function slugify(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function dedupeTickets(tickets: TicketCard[]) {
  return [...new Map(tickets.map((ticket) => [ticket.id, ticket])).values()];
}

function loadDashboardPreferences(): DashboardPreferences {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(PREFERENCE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as DashboardPreferences;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveDashboardPreferences(preferences: DashboardPreferences) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(PREFERENCE_KEY, JSON.stringify(preferences));
}

function loadThemePreference(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'dark';
  }

  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === 'dark' || stored === 'light') {
    return stored;
  }

  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyThemePreference(theme: ThemeMode) {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) {
    themeColorMeta.setAttribute('content', theme === 'light' ? '#f4f6fb' : '#2f3136');
  }
}

function saveThemePreference(theme: ThemeMode) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(THEME_KEY, theme);
}

function isImageAttachment(filename: string, preferences: Record<string, string> = {}) {
  const mimeType = String(
    preferences['Mime-Type'] ||
    preferences['mime-type'] ||
    preferences.content_type ||
    preferences.contentType ||
    '',
  ).toLowerCase();

  return mimeType.startsWith('image/') || /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(filename);
}

function attachmentSizeBytes(size: string | number | null | undefined) {
  if (typeof size === 'number') {
    return size;
  }

  const value = String(size || '').trim();
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (/kb/i.test(value)) {
    return parsed * 1024;
  }
  if (/mb/i.test(value)) {
    return parsed * 1024 * 1024;
  }

  return parsed;
}

function looksLikeCompanyLogo(value: string) {
  return /\b(kpn|bt|logo|signature|signatur|footer|banner|social|linkedin|facebook|twitter|instagram|youtube|icon|badge|avatar)\b/i
    .test(value);
}

function isLikelySignatureImage(filename: string, size?: string | number | null, preferences: Record<string, string> = {}) {
  const metadata = [
    filename,
    preferences.Name,
    preferences.name,
    preferences.filename,
    preferences.content_id,
    preferences['Content-ID'],
    preferences.Disposition,
    preferences.disposition,
  ].filter(Boolean).join(' ');
  const bytes = attachmentSizeBytes(size);

  return looksLikeCompanyLogo(metadata) || (/^image\d{3,}\./i.test(filename) && (bytes === null || bytes < 80 * 1024));
}

function normalizeInlineReference(value: string) {
  return String(value || '')
    .trim()
    .replace(/^cid:/i, '')
    .replace(/^<|>$/g, '')
    .toLowerCase();
}

function attachmentProxyUrl(ticketId: number, articleId: number, attachmentId: number) {
  return `${apiBase}/tickets/${ticketId}/attachments/${articleId}/${attachmentId}?view=inline`;
}

function ticketAttachmentUrlFromSource(src: string) {
  const match = String(src || '').match(/\/api\/v1\/ticket_attachment\/(\d+)\/(\d+)\/(\d+)(?:\?[^"\s]*)?$/i);
  if (!match) {
    return null;
  }

  return {
    ticketId: Number.parseInt(match[1], 10),
    articleId: Number.parseInt(match[2], 10),
    attachmentId: Number.parseInt(match[3], 10),
  };
}

function matchInlineAttachment(
  image: HTMLImageElement,
  attachments: Array<{ id: number; filename: string; size?: string | number | null; preferences?: Record<string, string> }>,
) {
  const src = image.getAttribute('src') || '';
  const alt = image.getAttribute('alt') || '';
  const title = image.getAttribute('title') || '';
  const dataFilename = image.getAttribute('data-filename') || '';
  const candidates = [src, alt, title, dataFilename]
    .map(normalizeInlineReference)
    .filter(Boolean);

  return attachments.find((attachment) => {
    const preferences = attachment.preferences || {};
    const attachmentCandidates = [
      attachment.filename,
      preferences.Name,
      preferences.name,
      preferences.filename,
      preferences.content_id,
      preferences['Content-ID'],
    ]
      .map(normalizeInlineReference)
      .filter(Boolean);

    return attachmentCandidates.some((candidate) => candidates.includes(candidate));
  }) || null;
}

function cleanedArticleBody(
  body: string,
  ticketId: number,
  articleId: number,
  attachments: Array<{ id: number; filename: string; size?: string | number | null; preferences?: Record<string, string> }> = [],
) {
  if (typeof window === 'undefined' || !body.includes('<img')) {
    return body;
  }

  const document = new DOMParser().parseFromString(body, 'text/html');
  document.querySelectorAll('img').forEach((image) => {
    const src = image.getAttribute('src') || '';
    const alt = image.getAttribute('alt') || '';
    const title = image.getAttribute('title') || '';
    const className = image.getAttribute('class') || '';
    const dataFilename = image.getAttribute('data-filename') || '';
    const descriptor = [src, alt, title, className, dataFilename].filter(Boolean).join(' ');
    const width = Number.parseInt(image.getAttribute('width') || '', 10);
    const height = Number.parseInt(image.getAttribute('height') || '', 10);
    const isSmallImage = Number.isFinite(width) && Number.isFinite(height) && width <= 220 && height <= 120;
    const matchedAttachment = matchInlineAttachment(image, attachments);
    const nativeAttachmentUrl = ticketAttachmentUrlFromSource(src);
    const isCidImage = src.startsWith('cid:');
    const isBrokenLocalImage = !src || src === 'about:blank';

    if (nativeAttachmentUrl) {
      image.setAttribute(
        'src',
        attachmentProxyUrl(nativeAttachmentUrl.ticketId, nativeAttachmentUrl.articleId, nativeAttachmentUrl.attachmentId),
      );
      image.removeAttribute('width');
      image.removeAttribute('height');
      image.setAttribute('loading', 'eager');
      image.removeAttribute('srcset');
      return;
    }

    if (matchedAttachment && isImageAttachment(matchedAttachment.filename, matchedAttachment.preferences)) {
      image.setAttribute('src', attachmentProxyUrl(ticketId, articleId, matchedAttachment.id));
      image.setAttribute('alt', matchedAttachment.filename);
      image.removeAttribute('width');
      image.removeAttribute('height');
      image.setAttribute('loading', 'eager');
      image.removeAttribute('srcset');
      return;
    }

    if (looksLikeCompanyLogo(descriptor) || isSmallImage || isCidImage || isBrokenLocalImage) {
      image.remove();
    }
  });

  document.querySelectorAll('a').forEach((anchor) => {
    if (!anchor.textContent?.trim() && anchor.children.length === 0) {
      anchor.remove();
    }
  });

  return document.body.innerHTML;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function isIosDevice() {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandaloneDisplayMode() {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.matchMedia('(display-mode: standalone)').matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function usePushNotifications() {
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [unsupportedReason, setUnsupportedReason] = useState('Your browser does not support web push from this PWA.');

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        if (mounted) {
          setSupported(false);
          setUnsupportedReason('Your browser does not support web push from this PWA.');
        }
        return;
      }

      if (isIosDevice() && !isStandaloneDisplayMode()) {
        if (mounted) {
          setSupported(false);
          setUnsupportedReason('On iPhone and iPad, open this app from the Home Screen icon to enable alerts.');
        }
        return;
      }

      setSupported(true);
      const pushConfig = await api.pushConfig().catch(() => null);
      if (!mounted) {
        return;
      }

      setConfig(pushConfig);
      if (!pushConfig?.enabled) {
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!mounted) {
        return;
      }

      setEnabled(Boolean(subscription));
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  async function toggle() {
    if (!supported || !config?.enabled) {
      setMessage('Push notifications are not configured on the server yet.');
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      const registration = await navigator.serviceWorker.ready;
      const existingSubscription = await registration.pushManager.getSubscription();

      if (existingSubscription) {
        await api.unsubscribePush(existingSubscription.endpoint);
        await existingSubscription.unsubscribe();
        setEnabled(false);
        setMessage('Mobile alerts disabled.');
        return;
      }

      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();

      if (permission !== 'granted') {
        setMessage('Notification permission was not granted.');
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey || ''),
      });

      await api.subscribePush(subscription.toJSON());
      setEnabled(true);
      setMessage('Mobile alerts enabled.');
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Unable to update notifications.';
      if (isIosDevice() && !isStandaloneDisplayMode()) {
        setMessage('On iPhone and iPad, alerts only work from the installed Home Screen app. Open it there and try again.');
      } else if (/registration failed|push service error/i.test(rawMessage)) {
        setMessage('Registration failed in the browser push service. Refresh once, then retry. If it still fails, remove old site data for this app URL and try again.');
      } else {
        setMessage(rawMessage);
      }
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    enabled,
    message,
    supported,
    unsupportedReason,
    serverEnabled: Boolean(config?.enabled),
    toggle,
  };
}

function ThemeToggle({ theme, onToggle }: { theme: ThemeMode; onToggle: () => void }) {
  return (
    <button className="ghost-button theme-toggle" onClick={onToggle} type="button">
      {theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
    </button>
  );
}

function AppHeader({
  session,
  theme,
  onLogout,
  onToggleTheme,
}: {
  session: Session;
  theme: ThemeMode;
  onLogout: () => void;
  onToggleTheme: () => void;
}) {
  return (
    <>
      <header className="app-header">
        <div className="app-header-copy">
          <p className="eyebrow">Zammad mobile overview</p>
          <h1>PowerDNS EMEA</h1>
          <p className="muted">Queue-first triage, tuned for quick handling on a phone.</p>
        </div>
        <div className="header-actions">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button className="ghost-button" onClick={onLogout} type="button">
            Sign out {session.username}
          </button>
        </div>
      </header>
      {session.readOnlyMode ? (
        <div className="read-only-banner">
          Read-only mode is enabled. You can browse live tickets, but replies and updates are blocked.
        </div>
      ) : null}
    </>
  );
}

function LoginScreen({ theme, onToggleTheme }: { theme: ThemeMode; onToggleTheme: () => void }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);

  const loginMutation = useMutation({
    mutationFn: () => api.login(username, password, remember),
    onSuccess: () => navigate('/', { replace: true }),
  });

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-card-header">
          <div>
            <p className="eyebrow">Installable PWA</p>
            <h1>PowerDNS ticket desk</h1>
          </div>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
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
          <label className="remember-field">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <span>Keep me logged in on this device</span>
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

const TicketCardView = memo(function TicketCardView({
  ticket,
  now,
  onClick,
}: {
  ticket: TicketCard;
  now: number;
  onClick: () => void;
}) {
  return (
    <button className="ticket-card" onClick={onClick} type="button">
      <div className="ticket-card-head">
        <div className="ticket-card-id">
          <span className="ticket-number">#{ticket.number}</span>
          {ticket.is_new ? <span className="ticket-new-pill">New</span> : null}
        </div>
        <span className="ticket-time">{formatDate(ticket.updated_at)}</span>
      </div>
      <div className="ticket-card-main">
        <div className="ticket-card-copy">
          <div className="ticket-card-badges">
            <span className="ticket-queue-pill">{ticket.queue_label}</span>
            <span className={clsx('ticket-state-pill', `ticket-state-${slugify(ticket.state)}`)}>{ticket.state}</span>
            {ticket.escalation_at ? <span className="ticket-escalation-pill">Escalated</span> : null}
          </div>
          <h3>{ticket.title}</h3>
          <p className="ticket-customer-line">{ticket.customer}</p>
          <SlaPanel ticket={ticket} now={now} compact />
        </div>
        <dl className="ticket-grid">
          <div>
            <dt>Owner</dt>
            <dd>{ticket.owner}</dd>
          </div>
          <div>
            <dt>Priority</dt>
            <dd>{ticket.priority}</dd>
          </div>
          <div>
            <dt>Queue</dt>
            <dd>{ticket.queue_label}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{ticket.state}</dd>
          </div>
        </dl>
      </div>
    </button>
  );
});

function PushSettings({
  busy,
  enabled,
  message,
  serverEnabled,
  supported,
  unsupportedReason,
  onToggle,
}: {
  busy: boolean;
  enabled: boolean;
  message: string;
  serverEnabled: boolean;
  supported: boolean;
  unsupportedReason: string;
  onToggle: () => Promise<void>;
}) {
  if (!supported) {
    return (
      <div className="push-banner">
        <strong>Mobile alerts unavailable.</strong>
        <span>{unsupportedReason}</span>
      </div>
    );
  }

  return (
    <div className="push-banner">
      <div>
        <strong>Mobile alerts</strong>
        <span>
          {serverEnabled
            ? 'New tickets, assignments to you, and customer updates.'
            : 'Push is not configured on the server yet.'}
        </span>
      </div>
      <button className="ghost-button" type="button" onClick={() => onToggle()} disabled={busy || !serverEnabled}>
        {busy ? 'Updating…' : enabled ? 'Disable alerts' : 'Enable alerts'}
      </button>
      {message ? <p className="muted push-message">{message}</p> : null}
    </div>
  );
}

function TicketComposer({
  initialArticleType,
  now,
  ticket,
  lookups,
  readOnlyMode,
}: {
  initialArticleType: 'reply' | 'note';
  now: number;
  ticket: TicketDetail;
  lookups: LookupsResponse;
  readOnlyMode: boolean;
}) {
  const queryClient = useQueryClient();
  const [articleType, setArticleType] = useState<'reply' | 'note'>(initialArticleType);
  const [subject, setSubject] = useState(ticket.title);
  const [body, setBody] = useState('');
  const [ownerId, setOwnerId] = useState(String(ticket.owner_id || lookups.defaultOwnerId));
  const [state, setState] = useState(ticket.state_name);
  const [priority, setPriority] = useState(ticket.priority_name);
  const [workflowMacro, setWorkflowMacro] = useState('');
  const [files, setFiles] = useState<FileList | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const replyTo = ticket.reply_recipients?.to || ticket.customer?.email || null;
  const replyCc = ticket.reply_recipients?.cc || [];
  const hasReplyRecipients = Boolean(replyTo) || replyCc.length > 0;

  return (
    <section className="composer">
      <div className="composer-header">
        <div>
          <p className="eyebrow">Update ticket</p>
          <h3>Reply, note, or route</h3>
          {articleType === 'reply' ? (
            <p className="muted">Replies follow the latest customer update and keep the customer-side recipients together.</p>
          ) : null}
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

      <div className="composer-sla-row">
        <SlaPanel ticket={ticket} now={now} compact />
      </div>

      {articleType === 'reply' ? (
        <div className="recipient-preview" aria-live="polite">
          <div className="recipient-preview-header">
            <strong>Reply audience</strong>
            <span className="muted">Taken from the latest customer update</span>
          </div>
          {hasReplyRecipients ? (
            <div className="recipient-preview-grid">
              <div className="recipient-row">
                <span className="recipient-label">To</span>
                <span className="recipient-value">{replyTo || 'No primary recipient found'}</span>
              </div>
              {replyCc.length > 0 ? (
                <div className="recipient-row">
                  <span className="recipient-label">Cc</span>
                  <span className="recipient-value">{replyCc.join(', ')}</span>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="muted recipient-warning">No customer recipients could be derived from the latest visible thread item.</p>
          )}
        </div>
      ) : null}

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
          <span>Zammad macro</span>
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

function TicketThread({
  now,
  onReplyAll,
  ticket,
}: {
  now: number;
  onReplyAll: () => void;
  ticket: TicketDetail;
}) {
  const sortedArticles = useMemo(
    () => [...ticket.articles].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
    [ticket.articles],
  );
  const latestCustomerArticleId = useMemo(
    () => sortedArticles.find((article) => !article.internal && String(article.sender || '').toLowerCase() === 'customer')?.id || null,
    [sortedArticles],
  );

  return (
    <section className="thread">
      <div className="detail-card">
        <p className="eyebrow">Ticket #{ticket.number}</p>
        <h2>{ticket.title}</h2>
        <div className="detail-status-row">
          <span className={clsx('ticket-state-pill', `ticket-state-${slugify(ticket.state_name)}`)}>{ticket.state_name}</span>
          <span className="ticket-queue-pill">{ticket.priority_name}</span>
          {ticket.escalation_at ? <span className="ticket-escalation-pill">Escalated</span> : null}
        </div>
        <p className="thread-note">Newest message first, closer to the fast triage flow in Zammad.</p>
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

      <SlaPanel ticket={ticket} now={now} />

      <div className="timeline">
        {sortedArticles.map((article, index) => (
          <TicketArticleView
            key={article.id}
            article={article}
            defaultExpanded={index === 0}
            isLatestCustomerUpdate={article.id === latestCustomerArticleId}
            onReplyAll={onReplyAll}
            ticketId={ticket.id}
          />
        ))}
      </div>
    </section>
  );
}

const TicketArticleView = memo(function TicketArticleView({
  article,
  defaultExpanded,
  isLatestCustomerUpdate,
  onReplyAll,
  ticketId,
}: {
  article: TicketDetail['articles'][number];
  defaultExpanded: boolean;
  isLatestCustomerUpdate: boolean;
  onReplyAll: () => void;
  ticketId: number;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const articleBody = useMemo(
    () => cleanedArticleBody(article.body, ticketId, article.id, article.attachments),
    [article.attachments, article.body, article.id, ticketId],
  );
  const plainBodyLength = article.body.replace(/<[^>]*>/g, '').trim().length;
  const hasQuotedHistory = /<blockquote|On\s+\w+,\s+\w+\s+\d{1,2},\s+\d{4}|<hr/i.test(article.body);
  const compressionThreshold = defaultExpanded ? 420 : 180;
  const shouldCompress = !expanded && (
    plainBodyLength > compressionThreshold ||
    hasQuotedHistory ||
    article.attachments.length > 0
  );

  return (
    <article
      className={clsx(
        'timeline-item',
        article.internal ? 'timeline-item-internal' : 'timeline-item-external',
        shouldCompress && 'timeline-item-compressed',
      )}
    >
      <div className="timeline-meta">
        <span>{article.internal ? 'Internal note' : 'Customer-visible reply'}</span>
        <span>{article.created_by_user?.fullname || article.created_by_user?.email || article.created_by}</span>
        <span>{formatDate(article.created_at)}</span>
      </div>
      {isLatestCustomerUpdate ? (
        <div className="timeline-actions">
          <button className="ghost-button timeline-action-button" type="button" onClick={onReplyAll}>
            Reply all
          </button>
          <span className="muted">Latest customer update</span>
        </div>
      ) : null}
      <h3>{article.subject || article.type}</h3>
      <div className="article-body" dangerouslySetInnerHTML={{ __html: articleBody }} />
      {shouldCompress ? (
        <button className="show-more-button" type="button" onClick={() => setExpanded(true)}>
          See more
        </button>
      ) : null}
      {article.attachments.length > 0 ? (
        <>
          <div className="inline-images">
            {article.attachments
              .filter((attachment) => (
                isImageAttachment(attachment.filename, attachment.preferences) &&
                !isLikelySignatureImage(attachment.filename, attachment.size, attachment.preferences)
              ))
              .map((attachment) => (
                <a
                  key={attachment.id}
                  href={`${apiBase}/tickets/${ticketId}/attachments/${article.id}/${attachment.id}?view=inline`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    alt={attachment.filename}
                    loading="eager"
                    src={`${apiBase}/tickets/${ticketId}/attachments/${article.id}/${attachment.id}?view=inline`}
                  />
                </a>
              ))}
          </div>
          <div className="attachments">
            {article.attachments.map((attachment) => (
              <a
                key={attachment.id}
                className="attachment-pill"
                href={`${apiBase}/tickets/${ticketId}/attachments/${article.id}/${attachment.id}`}
                target="_blank"
                rel="noreferrer"
              >
                {attachment.filename}
              </a>
            ))}
          </div>
        </>
      ) : null}
    </article>
  );
});

function DashboardPage({
  session,
  theme,
  onLogout,
  onToggleTheme,
}: {
  session: Session;
  theme: ThemeMode;
  onLogout: () => void;
  onToggleTheme: () => void;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const storedPreferences = loadDashboardPreferences();
  const [activeView, setActiveView] = useState<ViewKey>(storedPreferences.view || 'allActive');
  const [activeQueue, setActiveQueue] = useState(storedPreferences.queue || 'all');
  const [sortBy, setSortBy] = useState<SortKey>(storedPreferences.sort || 'updated');
  const [newTicketIds, setNewTicketIds] = useState<number[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const gestureStartX = useRef<number | null>(null);
  const seenTicketIds = useRef<Set<number>>(new Set());
  const push = usePushNotifications();
  const deferredSearch = useDeferredValue(search);

  const lookupsQuery = useQuery({
    queryKey: ['lookups'],
    queryFn: api.lookups,
  });

  const ticketsQuery = useQuery({
    queryKey: ['tickets', deferredSearch, sortBy],
    queryFn: () => api.listTickets(deferredSearch, 'all', sortBy),
    refetchInterval: AUTO_REFRESH_MS,
    refetchIntervalInBackground: true,
  });
  const globalViews = ticketsQuery.data?.views;
  const newTicketIdSet = useMemo(() => new Set(newTicketIds), [newTicketIds]);
  const allActiveTickets = useMemo(() => globalViews?.allActive?.tickets || [], [globalViews]);
  const currentTickets = useMemo(() => {
    const baseTickets = activeView === 'allActive'
      ? (activeQueue === 'all'
        ? allActiveTickets
        : allActiveTickets.filter((ticket) => ticket.queue_key === activeQueue))
      : (globalViews?.[activeView]?.tickets || []);

    return baseTickets.map((ticket) => ({
      ...ticket,
      is_new: newTicketIdSet.has(ticket.id),
    }));
  }, [activeQueue, activeView, allActiveTickets, globalViews, newTicketIdSet]);

  useEffect(() => {
    saveDashboardPreferences({
      queue: activeQueue,
      sort: sortBy,
      view: activeView,
    });
  }, [activeQueue, activeView, sortBy]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(`zammad-mobile-seen:${activeQueue}`);
      const parsed = stored ? JSON.parse(stored) : [];
      seenTicketIds.current = new Set(Array.isArray(parsed) ? parsed : []);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNewTicketIds([]);
    } catch {
      seenTicketIds.current = new Set();
      setNewTicketIds([]);
    }
  }, [activeQueue]);

  useEffect(() => {
    if (!allActiveTickets.length) {
      return;
    }

    const visibleTickets = activeQueue === 'all'
      ? allActiveTickets
      : allActiveTickets.filter((ticket) => ticket.queue_key === activeQueue);
    const currentIds = dedupeTickets(visibleTickets).map((ticket) => ticket.id);
    const previousSeen = seenTicketIds.current;

    if (previousSeen.size > 0) {
      const added = currentIds.filter((ticketId) => !previousSeen.has(ticketId));
      setNewTicketIds(added);
    }

    const nextSeen = new Set([...previousSeen, ...currentIds]);
    seenTicketIds.current = nextSeen;
    window.localStorage.setItem(`zammad-mobile-seen:${activeQueue}`, JSON.stringify([...nextSeen]));
  }, [activeQueue, allActiveTickets, ticketsQuery.data?.generatedAt]);

  const summary = useMemo(() => {
    if (!globalViews) {
      return [];
    }

    return VIEW_ORDER.map((key) => ({
      ...globalViews[key],
      newCount: globalViews[key].tickets.filter((ticket) => newTicketIdSet.has(ticket.id)).length,
    }));
  }, [globalViews, newTicketIdSet]);

  const queueSummary = useMemo(() => {
    const counts = new Map<string, { key: string; label: string; count: number }>();
    const sourceTickets = allActiveTickets.map((ticket) => ({
      ...ticket,
      is_new: newTicketIdSet.has(ticket.id),
    }));

    for (const ticket of sourceTickets) {
      const current = counts.get(ticket.queue_key);
      if (current) {
        current.count += 1;
      } else {
        counts.set(ticket.queue_key, {
          key: ticket.queue_key,
          label: ticket.queue_label,
          count: 1,
        });
      }
    }

    return (lookupsQuery.data?.queues || []).map((queue: QueueOption) => ({
      key: queue.key,
      label: queue.label,
      count: queue.key === 'all'
        ? sourceTickets.length
        : (counts.get(queue.key)?.count || 0),
    }));
  }, [allActiveTickets, lookupsQuery.data?.queues, newTicketIdSet]);

  const activeQueueLabel = queueSummary.find((queue) => queue.key === activeQueue)?.label || 'All queues';
  const activeQueueCount = queueSummary.find((queue) => queue.key === activeQueue)?.count || 0;
  const activeViewLabel = globalViews?.[activeView]?.label || 'Tickets';
  const activeViewCount = globalViews?.[activeView]?.tickets.length || 0;
  const isQueueOverview = activeView === 'allActive';
  const boardHeadingLabel = isQueueOverview ? activeQueueLabel : 'All PowerDNS Queues';
  const boardHeadingCount = isQueueOverview ? activeQueueCount : (queueSummary.find((queue) => queue.key === 'all')?.count || 0);
  const assignedOwnerLabel = useMemo(() => {
    const owner = lookupsQuery.data?.owners.find((entry) => entry.id === lookupsQuery.data?.defaultOwnerId);
    return owner?.label || `Owner #${lookupsQuery.data?.defaultOwnerId || session.defaultOwnerId}`;
  }, [lookupsQuery.data?.defaultOwnerId, lookupsQuery.data?.owners, session.defaultOwnerId]);
  const totalVisibleCount = queueSummary.find((queue) => queue.key === 'all')?.count || 0;

  return (
    <main className="app-shell">
      <AppHeader session={session} theme={theme} onLogout={onLogout} onToggleTheme={onToggleTheme} />
      <section className="dashboard-layout">
        <section className="dashboard-rail">
          <div className="overview-panel">
            <div className="overview-heading">
              <p className="eyebrow">Overview</p>
              <h2>Support board</h2>
              <p className="muted">Keep the same triage context between refreshes, even on mobile.</p>
            </div>
            <div className="overview-stats">
              <article className="overview-stat-card">
                <span className="overview-stat-label">Current view</span>
                <strong>{activeViewLabel}</strong>
                <small>{activeViewCount} tickets</small>
              </article>
              <article className="overview-stat-card">
                <span className="overview-stat-label">Current queue</span>
                <strong>{activeQueueLabel}</strong>
                <small>{activeQueueCount} active</small>
              </article>
              <article className="overview-stat-card">
                <span className="overview-stat-label">All visible</span>
                <strong>{totalVisibleCount}</strong>
                <small>Across PowerDNS queues</small>
              </article>
            </div>
          </div>

          <div className="overview-panel">
            <div className="overview-heading">
              <p className="eyebrow">Views</p>
              <h2>Triage lanes</h2>
            </div>
            <div className="view-tabs">
              {summary.map((view) => (
                <button
                  key={view.key}
                  type="button"
                  className={clsx('view-tab', activeView === view.key && 'view-tab-active')}
                  onClick={() => {
                    setActiveView(view.key);
                    if (view.key !== 'allActive') {
                      setActiveQueue('all');
                    }
                  }}
                >
                  <span>{view.label}</span>
                  <strong>{view.tickets.length}</strong>
                  {view.newCount > 0 ? <small className="tab-new-count">{view.newCount} new</small> : null}
                </button>
              ))}
            </div>
          </div>

          <div className="overview-panel">
            <div className="overview-heading">
              <p className="eyebrow">Queues</p>
              <h2>Routing</h2>
            </div>
            <div className="queue-rail">
              {queueSummary.map((queue) => (
                <button
                  key={queue.key}
                  type="button"
                  className={clsx('queue-link', activeQueue === queue.key && 'queue-link-active')}
                  onClick={() => {
                    setActiveQueue(queue.key);
                    setActiveView('allActive');
                  }}
                >
                  <span>{queue.label}</span>
                  <strong>{queue.count}</strong>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="board-panel">
          <section className="toolbar">
            <div className="board-heading-strip">
              <div>
                <p className="eyebrow">Active board</p>
                <h2>{isQueueOverview ? activeQueueLabel : activeViewLabel}</h2>
                <p className="board-subtitle">
                  {isQueueOverview
                    ? `${currentTickets.length} tickets visible in ${activeQueueLabel}.`
                    : `${currentTickets.length} tickets visible in ${activeViewLabel.toLowerCase()}.`} Auto-refresh every {AUTO_REFRESH_LABEL}.
                </p>
              </div>
              <button className="ghost-button" type="button" onClick={() => ticketsQuery.refetch()} disabled={ticketsQuery.isFetching}>
                {ticketsQuery.isFetching ? 'Refreshing…' : 'Refresh now'}
              </button>
            </div>

            <PushSettings {...push} onToggle={push.toggle} />
            <div className="toolbar-grid">
              <label className="search-field toolbar-search">
                <span>Search</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Ticket number or subject"
                />
              </label>
              <label className="field compact-field">
                <span>Sort</span>
                <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortKey)}>
                  <option value="updated">Latest activity first</option>
                  <option value="queue">Queue assignment</option>
                </select>
              </label>
              <div className="toolbar-chip-strip" aria-label="Active filters">
                <span className="toolbar-chip">
                  <strong>View</strong>
                  {activeViewLabel}
                </span>
                <span className="toolbar-chip">
                  <strong>Queue</strong>
                  {activeQueueLabel}
                </span>
              </div>
            </div>
            <div className="toolbar-footer">
              <p className="muted">
                {activeView === 'myAssigned'
                  ? `${assignedOwnerLabel} is the default owner for this session.`
                  : 'Swipe left or right on the ticket list to move between triage lanes on mobile.'}
              </p>
            </div>
          </section>

          <div className="board-header">
            <div>
              <p className="eyebrow">Queue snapshot</p>
              <h2>{boardHeadingLabel}</h2>
              <p className="board-subtitle">{boardHeadingCount} active tickets across all visible states</p>
            </div>
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
              <div className="empty-state">
                {activeView === 'myAssigned'
                  ? `No active tickets are currently assigned to ${assignedOwnerLabel}.`
                  : 'No tickets matched this view.'}
              </div>
            ) : null}
            {currentTickets.map((ticket, index) => (
              <Fragment key={ticket.id}>
                <TicketCardView ticket={ticket} now={now} onClick={() => navigate(`/tickets/${ticket.id}`)} />
                {index < currentTickets.length - 1 ? <div className="ticket-row-divider" aria-hidden="true" /> : null}
              </Fragment>
            ))}
          </section>
        </section>
      </section>
    </main>
  );
}

function TicketDetailPage({
  session,
  theme,
  onLogout,
  onToggleTheme,
}: {
  session: Session;
  theme: ThemeMode;
  onLogout: () => void;
  onToggleTheme: () => void;
}) {
  const params = useParams();
  const navigate = useNavigate();
  const ticketId = Number(params.ticketId);
  const [now, setNow] = useState(() => Date.now());
  const composerRef = useRef<HTMLElement | null>(null);
  const [composerIntent, setComposerIntent] = useState<'reply' | 'note'>('reply');
  const [composerResetToken, setComposerResetToken] = useState(0);

  const detailQuery = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => api.ticket(ticketId),
    refetchInterval: AUTO_REFRESH_MS,
    refetchIntervalInBackground: true,
  });
  const lookupsQuery = useQuery({
    queryKey: ['lookups'],
    queryFn: api.lookups,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (detailQuery.isLoading || lookupsQuery.isLoading) {
    return (
      <main className="app-shell">
        <AppHeader session={session} theme={theme} onLogout={onLogout} onToggleTheme={onToggleTheme} />
        <div className="empty-state">Loading ticket...</div>
      </main>
    );
  }

  if (detailQuery.error || lookupsQuery.error || !detailQuery.data || !lookupsQuery.data) {
    return (
      <main className="app-shell">
        <AppHeader session={session} theme={theme} onLogout={onLogout} onToggleTheme={onToggleTheme} />
        <div className="empty-state">{detailQuery.error?.message || lookupsQuery.error?.message || 'Ticket not found'}</div>
      </main>
    );
  }

  return (
    <main className="app-shell detail-shell">
      <AppHeader session={session} theme={theme} onLogout={onLogout} onToggleTheme={onToggleTheme} />
      <div className="detail-topbar">
        <button className="ghost-button" type="button" onClick={() => navigate(-1)}>
          Back to queues
        </button>
        <p className="muted">Refreshes automatically every {AUTO_REFRESH_LABEL} while you work.</p>
      </div>
      <TicketThread
        ticket={detailQuery.data}
        now={now}
        onReplyAll={() => {
          setComposerIntent('reply');
          setComposerResetToken((current) => current + 1);
          composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
      />
      <section ref={composerRef}>
        <TicketComposer
          key={`${detailQuery.data.id}-${composerIntent}-${composerResetToken}`}
          now={now}
          ticket={detailQuery.data}
          lookups={lookupsQuery.data}
          readOnlyMode={session.readOnlyMode}
          initialArticleType={composerIntent}
        />
      </section>
    </main>
  );
}

function ProtectedRoutes({ theme, onToggleTheme }: { theme: ThemeMode; onToggleTheme: () => void }) {
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
      <Route
        path="/"
        element={(
          <DashboardPage
            session={sessionQuery.data}
            theme={theme}
            onLogout={() => logoutMutation.mutate()}
            onToggleTheme={onToggleTheme}
          />
        )}
      />
      <Route
        path="/tickets/:ticketId"
        element={(
          <TicketDetailPage
            session={sessionQuery.data}
            theme={theme}
            onLogout={() => logoutMutation.mutate()}
            onToggleTheme={onToggleTheme}
          />
        )}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => loadThemePreference());

  useEffect(() => {
    applyThemePreference(theme);
    saveThemePreference(theme);
  }, [theme]);

  return (
    <Routes>
      <Route path="/login" element={<LoginScreen theme={theme} onToggleTheme={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} />} />
      <Route
        path="/*"
        element={<ProtectedRoutes theme={theme} onToggleTheme={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} />}
      />
    </Routes>
  );
}
