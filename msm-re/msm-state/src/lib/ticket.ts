/**
 * Mints a Steam auth session ticket for app 1419170 by running the
 * prebuilt ticket_helper.exe inside the CrossOver Steam bottle.
 *
 * The helper loads the game's own steam_api.dll, so Steam must be running
 * and logged in, but the game itself never launches.
 */

import { spawnSync } from 'node:child_process';
import { TICKET_HELPER_DEFAULTS } from './config.js';

export class TicketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TicketError';
  }
}

export type TicketResult = {
  /** Raw ticket bytes. */
  ticket: Buffer;
  /** SteamID64 parsed from the ticket. */
  steamId: string;
};

/**
 * Run ticket_helper.exe and parse its TICKET/TICKETLEN output.
 * Throws TicketError with the helper's stderr on failure.
 */
export function mintSteamTicket(
  wineBin: string = TICKET_HELPER_DEFAULTS.wineBin,
  bottle: string = TICKET_HELPER_DEFAULTS.bottle,
  exePath: string = TICKET_HELPER_DEFAULTS.exePath,
): TicketResult {
  const result = spawnSync(wineBin, ['--bottle', bottle, exePath], {
    encoding: 'utf8',
    timeout: 120_000,
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.error !== undefined) {
    throw new TicketError(`failed to run wine: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const reason = output
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('ERR:'));
    throw new TicketError(
      reason === undefined
        ? `ticket helper exited with code ${String(result.status)}`
        : `ticket helper failed: ${reason.replace(/^ERR:\s*/, '')}`,
    );
  }

  const ticketHex = /TICKET:([0-9a-fA-F]+)/.exec(output)?.[1];
  const ticketLen = /TICKETLEN:(\d+)/.exec(output)?.[1];
  if (ticketHex === undefined) {
    throw new TicketError('ticket helper produced no TICKET line');
  }
  const ticket = Buffer.from(ticketHex, 'hex');
  if (ticketLen !== undefined && Number(ticketLen) !== ticket.length) {
    throw new TicketError(
      `ticket length mismatch: header said ${ticketLen}, decoded ${ticket.length}`,
    );
  }
  return { ticket, steamId: steamIdFromTicket(ticket) };
}

/**
 * Extract the SteamID64 from a session ticket.
 *
 * Session tickets embed the 64-bit steamid as two little-endian dwords:
 * account id, then the fixed 0x01100001 "individual account / public
 * universe" high part (bytes 01 00 10 01). We locate that marker and read
 * the four bytes preceding it (tested with a synthetic account id).
 */
export function steamIdFromTicket(ticket: Buffer): string {
  const marker = Buffer.from([0x01, 0x00, 0x10, 0x01]);
  const idx = ticket.indexOf(marker);
  if (idx < 4) {
    throw new TicketError('could not locate steamid in ticket');
  }
  const accountId = ticket.readUInt32LE(idx - 4);
  return (0x0110000100000000n + BigInt(accountId)).toString();
}