/**
 * BBB auth API: exchanges a Steam session ticket for a bearer access token.
 *
 * Mirrors msm_buildAuthTokenRequest (@0x755A40) and the captured request to
 * https://auth.bbbgame.net/auth/api/token. Field names and the odd
 * "use-proper-json" header are exactly what the game sends.
 */

import { AUTH_URL, CLIENT_CONFIG } from '../lib/config.js';

export class AuthApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthApiError';
  }
}

export type AuthTokenResponse = {
  ok: boolean;
  user_game_id: string[];
  login_types: string[];
  access_token: string;
  token_type: string;
  expires_at: number;
  device_updated: boolean;
};

/** POST the ticket to /auth/api/token and return the parsed response. */
export async function fetchAccessToken(
  steamId: string,
  ticket: Buffer,
): Promise<AuthTokenResponse> {
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
  });

  const response = await fetch(AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'use-proper-json': 'true',
      Accept: '*/*',
    },
    body: form.toString(),
  });
  if (!response.ok) {
    throw new AuthApiError(`auth api returned HTTP ${String(response.status)}`);
  }
  const body = (await response.json()) as AuthTokenResponse & {
    error?: number;
    message?: string;
  };
  if (body.ok !== true || body.access_token === undefined) {
    const detail =
      body.error !== undefined && body.message !== undefined
        ? ` (error ${String(body.error)}: ${body.message})`
        : '';
    throw new AuthApiError(`auth api rejected the ticket${detail}`);
  }
  return body;
}