const fs = require('node:fs');
const path = require('node:path');
const { config } = require('./config');

function ensureAuditDir() {
  fs.mkdirSync(path.dirname(config.auditLogPath), { recursive: true });
}

function audit(action, payload = {}) {
  ensureAuditDir();
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    ...payload,
  };

  fs.appendFileSync(config.auditLogPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

module.exports = {
  audit,
};
