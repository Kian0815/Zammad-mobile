<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
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
=======
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
import fs from 'fs';
import { config } from './config.js';

export function auditLog(event, payload = {}) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...payload
  });
  fs.appendFile(config.auditLogPath, `${line}\n`, () => {});
}
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
