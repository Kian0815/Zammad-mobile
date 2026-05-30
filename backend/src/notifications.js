const fs = require('node:fs');
const path = require('node:path');
const webpush = require('web-push');
const { audit } = require('./audit');
const { config } = require('./config');
const { getTicket, listPowerDnsTickets, resolveAssignedOwnerIdForUsername } = require('./zammad');

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

function isInStateSet(ticket, stateNames) {
  return stateNames.has(String(ticket.state_name || '').toLowerCase());
}

function snapshotTicket(ticket) {
  return {
    id: ticket.id,
    number: ticket.number,
    title: ticket.title,
    updated_at: ticket.updated_at,
    owner: ticket.owner || null,
    owner_id: ticket.owner_id,
    state_name: ticket.state_name,
    priority_name: ticket.priority_name,
    priority_id: ticket.priority_id,
    escalation_at: ticket.escalation_at || null,
    latest_article_id: ticket.latest_article_id || null,
    latest_article_sender: ticket.latest_article_sender || null,
  };
}

function latestVisibleArticle(ticketDetail) {
  return (ticketDetail?.articles || []).find((article) => !article.internal) || null;
}

function snapshotFromDetail(ticket, ticketDetail, previous = null) {
  const latestArticle = latestVisibleArticle(ticketDetail);
  return {
    ...snapshotTicket(ticket),
    latest_article_id: latestArticle?.id || previous?.latest_article_id || null,
    latest_article_sender: String(latestArticle?.sender || previous?.latest_article_sender || '').toLowerCase() || null,
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

function deriveEvents(currentTickets, previousTickets, deliveredEventKeys, assignedOwnerId) {
  const delivered = new Set(deliveredEventKeys);
  const events = [];

  for (const ticket of currentTickets) {
    const previous = previousTickets[ticket.id];
    const candidates = [];

    if (!previous) {
      candidates.push({
        eventKey: `new:${ticket.id}:${ticket.updated_at}`,
        title: `New ticket #${ticket.number}`,
        body: ticket.title,
        tag: `ticket-new-${ticket.id}`,
        url: buildNotificationUrl(ticket.id),
      });
    } else {
      if (previous.owner_id !== assignedOwnerId && ticket.owner_id === assignedOwnerId) {
        candidates.push({
          eventKey: `assigned:${ticket.id}:${ticket.updated_at}:${assignedOwnerId}`,
          title: `Assigned to: ${ticket.owner || 'you'}`,
          body: ticket.title,
          tag: `ticket-assigned-${ticket.id}`,
          url: buildNotificationUrl(ticket.id),
        });
      }

      if (
        previous.updated_at !== ticket.updated_at &&
        previous.latest_article_id &&
        ticket.latest_article_id &&
        ticket.latest_article_id !== previous.latest_article_id &&
        ticket.latest_article_sender === 'customer'
      ) {
        candidates.push({
          eventKey: `customer-update:${ticket.id}:${ticket.latest_article_id}`,
          title: `Update to ${ticket.title}`,
          body: `Customer update on #${ticket.number}`,
          tag: `ticket-customer-update-${ticket.id}`,
          url: buildNotificationUrl(ticket.id),
        });
      }

      if (candidates.length === 0 && isEscalated(ticket) && !isEscalated(previous) && ticket.latest_article_sender === 'customer') {
        candidates.push({
          eventKey: `escalated:${ticket.id}:${ticket.updated_at}`,
          title: `Escalated update #${ticket.number}`,
          body: `${ticket.priority_name} · ${ticket.title}`,
          tag: `ticket-escalated-${ticket.id}`,
          url: buildNotificationUrl(ticket.id),
        });
      }
    }

    const selected = candidates.find((candidate) => !delivered.has(candidate.eventKey));
    if (selected) {
      events.push(selected);
    }
  }

  return events;
}

async function pollNotifications() {
  try {
    const currentTicketCards = await listPowerDnsTickets('', 'all');
    const state = loadNotificationState();
    const assignedOwnerId = await resolveAssignedOwnerIdForUsername(config.appUser);
    const changedTickets = currentTicketCards.filter((ticket) => {
      const previous = state.tickets?.[ticket.id];
      return !previous || previous.updated_at !== ticket.updated_at || previous.owner_id !== ticket.owner_id;
    });
    const ticketDetails = await Promise.all(changedTickets.map(async (ticket) => {
      try {
        return [ticket.id, await getTicket(ticket.id)];
      } catch (_error) {
        return [ticket.id, null];
      }
    }));
    const detailMap = new Map(ticketDetails);
    const currentTickets = currentTicketCards.map((ticket) => snapshotFromDetail(ticket, detailMap.get(ticket.id), state.tickets?.[ticket.id]));

    if (!state.tickets || Object.keys(state.tickets).length === 0) {
      saveNotificationState({
        tickets: Object.fromEntries(currentTickets.map((ticket) => [ticket.id, ticket])),
        deliveredEventKeys: state.deliveredEventKeys || [],
      });
      return;
    }

    const events = deriveEvents(currentTickets, state.tickets, state.deliveredEventKeys || [], assignedOwnerId);
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
    setInterval(pollNotifications, Math.max(config.notifications.pollSeconds, 5) * 1000);
  }, 5_000);
}

module.exports = {
  getPushConfig,
  removeSubscription,
  saveSubscription,
  startNotificationPolling,
};
