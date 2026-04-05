const fs = require('node:fs');
const path = require('node:path');
const webpush = require('web-push');
const { audit } = require('./audit');
const { config } = require('./config');
const { listPowerDnsTickets } = require('./zammad');

let pollingStarted = false;

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }

    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function isPushConfigured() {
  return Boolean(config.push.subject && config.push.publicKey && config.push.privateKey);
}

if (isPushConfigured()) {
  webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);
}

function getPushConfig() {
  return {
    enabled: isPushConfigured(),
    publicKey: isPushConfigured() ? config.push.publicKey : null,
  };
}

function listSubscriptions() {
  return readJson(config.push.subscriptionStorePath, []);
}

function saveSubscriptions(subscriptions) {
  writeJson(config.push.subscriptionStorePath, subscriptions);
}

function saveSubscription(username, subscription) {
  if (!subscription?.endpoint) {
    throw new Error('Push subscription endpoint is required.');
  }

  const subscriptions = listSubscriptions().filter((entry) => entry.endpoint !== subscription.endpoint);
  subscriptions.push({
    username,
    endpoint: subscription.endpoint,
    keys: subscription.keys || {},
    expirationTime: subscription.expirationTime || null,
    createdAt: new Date().toISOString(),
  });
  saveSubscriptions(subscriptions);
}

function removeSubscription(endpoint) {
  const subscriptions = listSubscriptions();
  saveSubscriptions(subscriptions.filter((entry) => entry.endpoint !== endpoint));
}

function isEscalated(ticket) {
  const highPriorityNameSet = new Set(config.powerdns.highPriorityNames);
  const highPriorityIdSet = new Set(config.powerdns.highPriorityIds);
  const priorityName = String(ticket.priority_name || '').toLowerCase();
  return Boolean(ticket.escalation_at) || highPriorityNameSet.has(priorityName) || highPriorityIdSet.has(ticket.priority_id);
}

function snapshotTicket(ticket) {
  return {
    id: ticket.id,
    number: ticket.number,
    title: ticket.title,
    updated_at: ticket.updated_at,
    owner_id: ticket.owner_id,
    state_name: ticket.state_name,
    priority_name: ticket.priority_name,
    priority_id: ticket.priority_id,
    escalation_at: ticket.escalation_at || null,
  };
}

function loadNotificationState() {
  return readJson(config.notifications.statePath, {
    tickets: {},
    deliveredEventKeys: [],
  });
}

function saveNotificationState(state) {
  writeJson(config.notifications.statePath, state);
}

function buildNotificationUrl(ticketId) {
  return new URL(`tickets/${ticketId}`, config.publicAppUrl).toString();
}

async function sendNotificationToAll(payload, eventKey) {
  if (!isPushConfigured()) {
    return;
  }

  const subscriptions = listSubscriptions();
  if (subscriptions.length === 0) {
    return;
  }

  const message = JSON.stringify(payload);
  const expiredEndpoints = [];

  await Promise.allSettled(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification(subscription, message);
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        expiredEndpoints.push(subscription.endpoint);
      } else {
        audit('push.send_failed', {
          endpoint: subscription.endpoint,
          statusCode: error.statusCode || null,
          body: error.body || error.message,
          eventKey,
        });
      }
    }
  }));

  if (expiredEndpoints.length > 0) {
    const stale = new Set(expiredEndpoints);
    saveSubscriptions(subscriptions.filter((entry) => !stale.has(entry.endpoint)));
  }
}

function deriveEvents(currentTickets, previousTickets, deliveredEventKeys) {
  const delivered = new Set(deliveredEventKeys);
  const events = [];

  for (const ticket of currentTickets) {
    const previous = previousTickets[ticket.id];

    if (!previous) {
      const eventKey = `new:${ticket.id}:${ticket.updated_at}`;
      if (!delivered.has(eventKey)) {
        events.push({
          eventKey,
          title: `New PowerDNS ticket #${ticket.number}`,
          body: ticket.title,
          tag: `ticket-new-${ticket.id}`,
          url: buildNotificationUrl(ticket.id),
        });
      }
    }

    if (previous && previous.updated_at !== ticket.updated_at && ticket.owner_id === config.powerdns.defaultOwnerId) {
      const eventKey = `assigned-update:${ticket.id}:${ticket.updated_at}`;
      if (!delivered.has(eventKey)) {
        events.push({
          eventKey,
          title: `Assigned ticket updated #${ticket.number}`,
          body: ticket.title,
          tag: `ticket-update-${ticket.id}`,
          url: buildNotificationUrl(ticket.id),
        });
      }
    }

    if (isEscalated(ticket) && (!previous || !isEscalated(previous))) {
      const eventKey = `escalated:${ticket.id}:${ticket.updated_at}`;
      if (!delivered.has(eventKey)) {
        events.push({
          eventKey,
          title: `Escalated or high priority #${ticket.number}`,
          body: `${ticket.priority_name} · ${ticket.title}`,
          tag: `ticket-escalated-${ticket.id}`,
          url: buildNotificationUrl(ticket.id),
        });
      }
    }
  }

  return events;
}

async function pollNotifications() {
  try {
    const currentTickets = (await listPowerDnsTickets('', 'all')).map(snapshotTicket);
    const state = loadNotificationState();

    if (!state.tickets || Object.keys(state.tickets).length === 0) {
      saveNotificationState({
        tickets: Object.fromEntries(currentTickets.map((ticket) => [ticket.id, ticket])),
        deliveredEventKeys: state.deliveredEventKeys || [],
      });
      return;
    }

    const events = deriveEvents(currentTickets, state.tickets, state.deliveredEventKeys || []);
    for (const event of events) {
      await sendNotificationToAll({
        title: event.title,
        body: event.body,
        tag: event.tag,
        url: event.url,
      }, event.eventKey);
      audit('push.event_sent', {
        eventKey: event.eventKey,
        title: event.title,
        url: event.url,
      });
    }

    const deliveredEventKeys = [...new Set([...(state.deliveredEventKeys || []), ...events.map((event) => event.eventKey)])].slice(-500);
    saveNotificationState({
      tickets: Object.fromEntries(currentTickets.map((ticket) => [ticket.id, ticket])),
      deliveredEventKeys,
    });
  } catch (error) {
    audit('push.poll_failed', {
      error: error.message,
    });
  }
}

function startNotificationPolling() {
  if (pollingStarted) {
    return;
  }

  pollingStarted = true;
  setTimeout(() => {
    pollNotifications();
    setInterval(pollNotifications, Math.max(config.notifications.pollSeconds, 15) * 1000);
  }, 5_000);
}

module.exports = {
  getPushConfig,
  removeSubscription,
  saveSubscription,
  startNotificationPolling,
};
