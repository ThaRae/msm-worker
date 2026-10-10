/**
 * Protocol constants captured from the live game (mitmproxy + IDA reversing).
 *
 * - g=27 is the "game" id the PC client reports.
 * - The client sends a shared access key (the default of BBB_ACCESS_KEY,
 *   returned by msm_getBbbAccessKey @ 0x75E4E0). It is not published here;
 *   recover it from your own copy of the client and set MSM_ACCESS_KEY.
 * - Set MSM_DEVICE_ID to your own pc_device_id from local login.xml.
 */

export const CLIENT_CONFIG = {
  gameId: '27',
  loginType: 'steam',
  authVersion: '2.0.0',
  clientVersion: '5.7.0',
  deviceId: process.env.MSM_DEVICE_ID ?? '00000000-0000-4000-8000-000000000001',
  deviceModel: 'PCDevice',
  deviceVendor: 'wintel',
  osVersion: '10.0.19045',
  platform: 'pc',
  language: 'en',
  sfsZone: 'MySingingMonsters',
} as const;

/** The client's shared access key, read from MSM_ACCESS_KEY at call time. */
export function bbbAccessKey(): string {
  const key = process.env.MSM_ACCESS_KEY?.trim();
  if (key === undefined || key === '') {
    throw new Error('MSM_ACCESS_KEY is not set; see the msm-state README (Local settings)');
  }
  return key;
}

export const AUTH_URL = 'https://auth.bbbgame.net/auth/api/token';
export const PREGAME_URL = 'https://msmpc.bbbgame.net/pregame_setup.php';

export const USER_AGENT = `MSMPC/${CLIENT_CONFIG.clientVersion} (pc; ${CLIENT_CONFIG.osVersion})`;

/** Defaults for running the Steam ticket helper via CrossOver wine. */
export const TICKET_HELPER_DEFAULTS = {
  wineBin: '/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/wine',
  bottle: 'Steam',
  exePath:
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\My Singing Monsters\\ticket_helper.exe',
} as const;