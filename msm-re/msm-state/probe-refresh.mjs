/** One-off: check whether /auth/api/token issues a refresh_token when asked. */

import { mintSteamTicket } from './dist/lib/ticket.js';
import { fetchAccessToken } from './dist/services/authApi.js';
import { CLIENT_CONFIG, AUTH_URL, USER_AGENT } from './dist/lib/config.js';

const { ticket, steamId } = mintSteamTicket();
console.log('steamid', steamId);

// Same body fetchAccessToken sends, plus use_refresh_token=1 (the flag the
// client appends on its bind/ request, sub_75B160).
const form = new URLSearchParams({
  g: CLIENT_CONFIG.gameId,
  u: steamId,
  p: ticket.toString('hex'),
  t: CLIENT_CONFIG.loginType,
  advertiser_id: '',
  auth_version: CLIENT_CONFIG.authVersion,
  client_version: CLIENT_CONFIG.clientVersion,
  device_id: CLIENT_CONFIG.deviceId,
  device_model: CLIENT_CONFIG.deviceModel,
  device_vendor: CLIENT_CONFIG.deviceVendor,
  lang: CLIENT_CONFIG.language,
  os_version: CLIENT_CONFIG.osVersion,
  package: '',
  platform: CLIENT_CONFIG.platform,
  update_device: '1',
  use_refresh_token: '1',
});

const response = await fetch(AUTH_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'use-proper-json': 'true',
    'User-Agent': USER_AGENT,
    Accept: '*/*',
  },
  body: form.toString(),
});
console.log('HTTP', response.status);
const body = await response.json();
console.log(Object.keys(body).join(', '));
const { access_token, refresh_token, ...safeBody } = body;
console.log(JSON.stringify(safeBody, null, 2).slice(0, 2000));
process.exit(0);