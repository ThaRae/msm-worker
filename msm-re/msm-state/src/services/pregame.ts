/**
 * pregame_setup.php: asks BBB which game server to connect to.
 *
 * Mirrors msm_buildPregameSetupRequest (@0x757530) and the captured request.
 * The Authorization header carries the raw access token (no "Bearer"
 * prefix) — that quirk comes straight from the client.
 */

import { PREGAME_URL, USER_AGENT, CLIENT_CONFIG, bbbAccessKey } from '../lib/config.js';

export class PregameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PregameError';
  }
}

export type PregameResponse = {
  ok: boolean;
  serverId: number;
  /** Format: "tomcat|ssl|host" (fields split on '|' in the client). */
  serverIp: string;
  contentUrl: string;
};

export type GameServerEndpoint = {
  host: string;
  port: number;
  useSsl: boolean;
};

export async function fetchPregameSetup(
  accessToken: string,
): Promise<PregameResponse> {
  const form = new URLSearchParams({
    g: CLIENT_CONFIG.gameId,
    access_key: bbbAccessKey(),
    tcs: '1',
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
  });

  const response = await fetch(PREGAME_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
      Authorization: accessToken,
      Accept: '*/*',
    },
    body: form.toString(),
  });
  if (!response.ok) {
    throw new PregameError(`pregame_setup returned HTTP ${String(response.status)}`);
  }
  const body = (await response.json()) as PregameResponse;
  if (body.ok !== true || body.serverIp === undefined) {
    throw new PregameError('pregame_setup did not return a server');
  }
  return body;
}

/**
 * Parse the serverIp string the way sfs_SFSTomcatClient_connect (@0xDAA720)
 * does: "type|ssl|host[|port]". Port defaults to 443 with ssl, else 80.
 */
export function parseGameServer(serverIp: string): GameServerEndpoint {
  const parts = serverIp.split('|');
  if (parts.length < 3) {
    throw new PregameError(`unexpected serverIp format: ${serverIp}`);
  }
  const host = parts[2]!;
  const useSsl = parts[1] === 'ssl';
  const port = parts.length > 3 ? Number(parts[3]) : useSsl ? 443 : 80;
  if (!Number.isInteger(port) || port <= 0 || port > 0xffff) {
    throw new PregameError(`invalid port in serverIp: ${serverIp}`);
  }
  return { host, port, useSsl };
}