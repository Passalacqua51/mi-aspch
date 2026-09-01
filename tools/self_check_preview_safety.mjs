import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.PREVIEW_MODE = 'true';
process.env.GOOGLE_ENABLED = 'true';
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'preview@example.test';
process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = 'not-used-by-capability-check';
process.env.GOOGLE_SHEETS_READ = 'true';
process.env.GOOGLE_SHEETS_WRITE = 'true';
process.env.GOOGLE_CALENDAR_READ = 'true';
process.env.GOOGLE_CALENDAR_WRITE = 'true';
process.env.GOOGLE_GMAIL_SEND = 'true';
process.env.GOOGLE_GMAIL_OTP_SEND = 'true';
process.env.GOOGLE_GMAIL_NOTIFICATION_SEND = 'true';
process.env.VAPID_PUBLIC_KEY = 'configured';
process.env.VAPID_PRIVATE_KEY = 'configured';

const google = await import('../lib/google.mjs');
const push = await import('../lib/push.mjs');
const capabilities = google.googleCapabilities();
assert.equal(capabilities.previewMode, true);
assert.equal(capabilities.sheets.read, true);
assert.equal(capabilities.calendar.read, true);
assert.equal(capabilities.sheets.write, false);
assert.equal(capabilities.calendar.write, false);
assert.equal(capabilities.gmail.send, false);
assert.equal(capabilities.gmail.otp, false);
assert.equal(capabilities.gmail.notifications, false);
assert.equal(push.pushEnabled(), false);

const compose = fs.readFileSync(new URL('../compose.preview.yaml', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const lab = fs.readFileSync(new URL('../public/lab.js', import.meta.url), 'utf8');
assert.match(compose, /host_ip: \$\{PREVIEW_BIND_IP\}/);
assert.match(compose, /restart: unless-stopped/);
assert.match(compose, /max-size: 10m/);
assert.match(compose, /aspch_mi_aspch_data:\/production:ro/);
assert.match(compose, /SESSION_COOKIE_NAME: mi_aspch_preview_session/);
assert.doesNotMatch(compose, /0\.0\.0\.0:8086|127\.0\.0\.1:8086/);
assert.match(server, /POST' && p === '\/api\/preview\/impersonate'/);
assert.match(server, /!PREVIEW_MODE && p\.startsWith\('\/api\/preview\/'\).*404/);
assert.doesNotMatch(server, /lab-interceptor|\/api\/preview\/login|\/api\/preview\/members|url\.searchParams\.get\('sim'\)/);
assert.match(lab, /fetch\('\/api\/preview\/impersonate'/);
assert.doesNotMatch(lab, /sessionStorage|serviceWorker|caches\./);

console.log('preview-safety self-check OK: sesiones sintéticas aisladas; READ real permitido; Sheets/Calendar WRITE, Gmail y Push bloqueados');
