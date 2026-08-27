import crypto from 'node:crypto';

const tokenCache = new Map();

function env(name, fallback = '') { return process.env[name] ?? fallback; }
function base64url(input) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return b.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function encodePath(v) { return encodeURIComponent(v).replace(/%2F/g, '/'); }

const flag=(name,fallback=false)=>['1','true','yes','si','sí','on'].includes(String(env(name,String(fallback))).toLowerCase());
export function googleEnabled() {
  return flag('GOOGLE_ENABLED',false) && !!env('GOOGLE_SERVICE_ACCOUNT_EMAIL') && !!env('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');
}
export function sheetsReadEnabled(){return googleEnabled()&&flag('GOOGLE_SHEETS_READ',true)}
export function sheetsWriteEnabled(){return googleEnabled()&&flag('GOOGLE_SHEETS_WRITE',true)}
export function calendarReadEnabled(){return googleEnabled()&&flag('GOOGLE_CALENDAR_READ',true)}
export function calendarWriteEnabled(){return googleEnabled()&&flag('GOOGLE_CALENDAR_WRITE',false)}
export function gmailOtpSendEnabled(){return googleEnabled()&&flag('GOOGLE_GMAIL_OTP_SEND',flag('GOOGLE_GMAIL_SEND',false))}
export function gmailNotificationSendEnabled(){return googleEnabled()&&flag('GOOGLE_GMAIL_NOTIFICATION_SEND',false)}
export function gmailSendEnabled(){return gmailOtpSendEnabled()||gmailNotificationSendEnabled()}
export function googleCapabilities(){return {enabled:googleEnabled(),sheets:{read:sheetsReadEnabled(),write:sheetsWriteEnabled()},calendar:{read:calendarReadEnabled(),write:calendarWriteEnabled()},gmail:{send:gmailSendEnabled(),otp:gmailOtpSendEnabled(),notifications:gmailNotificationSendEnabled()}}}
function requireCap(ok,message){if(!ok)throw new Error(message)}

async function getAccessToken(scopes) {
  if (!googleEnabled()) throw new Error('Google Workspace no está habilitado en .env');
  const scope = [...new Set(scopes)].sort().join(' ');
  const subject = env('GOOGLE_IMPERSONATE_USER');
  const key = scope + '|' + subject;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payloadObj = {
    iss: env('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  if (subject) payloadObj.sub = subject;
  const payload = base64url(JSON.stringify(payloadObj));
  const unsigned = `${header}.${payload}`;
  const privateKey = env('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY').replace(/\\n/g, '\n');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey);
  const assertion = `${unsigned}.${base64url(signature)}`;

  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) throw new Error(`OAuth Google ${res.status}: ${await res.text()}`);
  const json = await res.json();
  tokenCache.set(key, { token: json.access_token, expiresAt: Date.now() + (json.expires_in || 3600) * 1000 });
  return json.access_token;
}

async function googleFetch(url, { scopes, ...options }) {
  const token = await getAccessToken(scopes);
  const headers = new Headers(options.headers || {});
  headers.set('authorization', `Bearer ${token}`);
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) throw new Error(`Google API ${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}

export async function sheetsGet(spreadsheetId, range) {
  requireCap(sheetsReadEnabled(),'Google Sheets READ deshabilitado temporalmente.');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodePath(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
  return googleFetch(url, { scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
}

export async function sheetsMetadata(spreadsheetId) {
  requireCap(sheetsWriteEnabled(),'Google Sheets WRITE deshabilitado temporalmente.');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`;
  return googleFetch(url, { scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
}

export async function ensureSheet(spreadsheetId, title) {
  requireCap(sheetsWriteEnabled(),'Google Sheets WRITE deshabilitado temporalmente.');
  const meta = await sheetsMetadata(spreadsheetId);
  if (meta.sheets?.some(s => s.properties?.title === title)) return;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
  await googleFetch(url, {
    scopes: ['https://www.googleapis.com/auth/spreadsheets'], method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] })
  });
}

export async function sheetsAppend(spreadsheetId, range, values) {
  requireCap(sheetsWriteEnabled(),'Google Sheets WRITE deshabilitado temporalmente.');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodePath(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  return googleFetch(url, {
    scopes: ['https://www.googleapis.com/auth/spreadsheets'], method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ values })
  });
}

export async function sheetsUpdate(spreadsheetId, range, values) {
  requireCap(sheetsWriteEnabled(),'Google Sheets WRITE deshabilitado temporalmente.');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodePath(range)}?valueInputOption=USER_ENTERED`;
  return googleFetch(url, {
    scopes: ['https://www.googleapis.com/auth/spreadsheets'], method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ range, majorDimension:'ROWS', values })
  });
}

export async function listCalendarEvents({ calendarId, timeMin, timeMax }) {
  requireCap(calendarReadEnabled(),'Google Calendar READ deshabilitado temporalmente.');
  const all = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({
      timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', timeZone: 'America/Santiago'
    });
    if (pageToken) q.set('pageToken', pageToken);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${q}`;
    const json = await googleFetch(url, { scopes: ['https://www.googleapis.com/auth/calendar.events.readonly'] });
    all.push(...(json.items || []));
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return all;
}

export async function deleteCalendarEvent({ calendarId, eventId, sendUpdates='all' }) {
  requireCap(calendarWriteEnabled(),'Google Calendar WRITE deshabilitado temporalmente.');
  const q = new URLSearchParams({ sendUpdates });
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?${q}`;
  return googleFetch(url, { scopes: ['https://www.googleapis.com/auth/calendar.events'], method: 'DELETE' });
}

export async function sendWorkspaceEmail({ to, subject, lines=[] }) {
  requireCap(gmailNotificationSendEnabled(),'Gmail de notificaciones deshabilitado temporalmente.');
  const from = env('OTP_FROM_EMAIL', env('GOOGLE_IMPERSONATE_USER'));
  if (!from) throw new Error('OTP_FROM_EMAIL no configurado');
  const recipients = Array.isArray(to) ? to.filter(Boolean).join(', ') : String(to || '').trim();
  if (!recipients) throw new Error('Destinatario de correo no configurado');
  const encodedSubject = Buffer.from(String(subject || 'Mi ASPCH'), 'utf8').toString('base64');
  const message = [
    `From: Mi ASPCH <${from}>`,
    `To: ${recipients}`,
    `Subject: =?UTF-8?B?${encodedSubject}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    ...lines.map(x => String(x)),
    '',
    'Este mensaje fue generado por Mi ASPCH.'
  ].join('\r\n');
  const raw = base64url(Buffer.from(message, 'utf8'));
  const url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
  return googleFetch(url, {
    scopes: ['https://www.googleapis.com/auth/gmail.send'], method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw })
  });
}

export async function sendOtpEmail({ to, code, kind='login' }) {
  requireCap(gmailOtpSendEnabled(),'Gmail OTP deshabilitado temporalmente.');
  const from = env('OTP_FROM_EMAIL', env('GOOGLE_IMPERSONATE_USER'));
  if (!from) throw new Error('OTP_FROM_EMAIL no configurado');
  const templates = {
    login: {
      subject:'Código de acceso · Mi ASPCH',
      lines:[`Tu código para ingresar a Mi ASPCH es: ${code}`]
    },
    register: {
      subject:'Activa tu acceso · Mi ASPCH',
      lines:[`Tu código para activar Mi ASPCH es: ${code}`]
    },
    email_new: {
      subject:'Confirma tu nuevo correo · Mi ASPCH',
      lines:[`Se solicitó usar este correo en Mi ASPCH. Tu código de confirmación es: ${code}`]
    },
    email_old: {
      subject:'Autoriza cambio de correo · Mi ASPCH',
      lines:[`Se solicitó cambiar el correo asociado a tu cuenta ASPCH. Para autorizarlo usa este código: ${code}`,
        'Si tú no solicitaste este cambio, no compartas el código y avisa a ASPCH.']
    }
  };
  const t = templates[kind] || templates.login;
  const subject = Buffer.from(t.subject, 'utf8').toString('base64');
  const message = [
    `From: Mi ASPCH <${from}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${subject}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    ...t.lines,
    '',
    'El código vence en 10 minutos. Nunca compartas tu PIN personal de Mi ASPCH.'
  ].join('\r\n');
  const raw = base64url(Buffer.from(message, 'utf8'));
  const url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
  return googleFetch(url, {
    scopes: ['https://www.googleapis.com/auth/gmail.send'], method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw })
  });
}


export async function sheetsBatchUpdate(spreadsheetId, data=[]) {
  requireCap(sheetsWriteEnabled(),'Google Sheets WRITE deshabilitado temporalmente.');
  if(!Array.isArray(data)||!data.length)return {totalUpdatedCells:0};
  const url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`;
  return googleFetch(url,{scopes:['https://www.googleapis.com/auth/spreadsheets'],method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({valueInputOption:'USER_ENTERED',data:data.map(x=>({range:x.range,majorDimension:'ROWS',values:x.values}))})});
}
