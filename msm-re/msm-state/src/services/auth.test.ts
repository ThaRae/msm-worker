/**
 * Token cache behavior: the file is a bearer credential, so these pin down
 * the save/load roundtrip, the 0600 permission, and the expiry margin that
 * decides when a cached token can be reused without touching Steam.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadStoredToken,
  saveStoredToken,
  isTokenFresh,
  defaultTokenCachePath,
  type StoredToken,
} from './auth.js';
import type { AuthTokenResponse } from './authApi.js';

function tmpCachePath(name: string): string {
  return join(tmpdir(), `msm-auth-test-${process.pid}-${name}.json`);
}

const apiToken: AuthTokenResponse = {
  ok: true,
  user_game_id: ['example-user-game-id'],
  login_types: ['steam'],
  access_token: 'deadbeefcafe',
  token_type: 'bearer',
  expires_at: 4_000_000_000,
  device_updated: true,
};

const stored: StoredToken = {
  access_token: 'deadbeefcafe',
  token_type: 'bearer',
  expires_at: 4_000_000_000,
  user_game_id: ['example-user-game-id'],
  steam_id: '76561197960265729',
  saved_at: 1_000,
};

test('save/load roundtrip preserves the credential fields', () => {
  const path = tmpCachePath('roundtrip');
  try {
    saveStoredToken(path, apiToken, '76561197960265729');
    const loaded = loadStoredToken(path);
    assert.notEqual(loaded, undefined);
    assert.equal(loaded?.access_token, 'deadbeefcafe');
    assert.equal(loaded?.token_type, 'bearer');
    assert.equal(loaded?.expires_at, 4_000_000_000);
    assert.deepEqual(loaded?.user_game_id, ['example-user-game-id']);
    assert.equal(loaded?.steam_id, '76561197960265729');
  } finally {
    rmSync(path, { force: true });
  }
});

test('the cache file is only readable by its owner (mode 600)', () => {
  const path = tmpCachePath('mode');
  try {
    saveStoredToken(path, apiToken, '76561197960265729');
    // macOS/Linux: 0o600 & ~umask; other-owner bits must never be set.
    assert.equal(statSync(path).mode & 0o077, 0);
  } finally {
    rmSync(path, { force: true });
  }
});

test('loading a missing cache returns undefined', () => {
  assert.equal(loadStoredToken(tmpCachePath('missing')), undefined);
});

test('a cache missing credential fields is rejected, not silently empty', () => {
  const path = tmpCachePath('malformed');
  try {
    writeFileSync(path, '{"token_type":"bearer"}');
    assert.throws(() => loadStoredToken(path), /missing access_token/);
  } finally {
    rmSync(path, { force: true });
  }
});

test('isTokenFresh honors the expiry margin', () => {
  const now = 3_999_999_000;
  assert.equal(isTokenFresh(stored, now), true);
  // Inside the 120s margin the token counts as expired so we re-mint
  // before the server can reject us mid-session.
  assert.equal(isTokenFresh(stored, 3_999_999_950), false);
  assert.equal(isTokenFresh(stored, 4_000_000_001), false);
  // A custom margin moves the cutoff.
  assert.equal(isTokenFresh(stored, 3_999_999_950, 30), true);
});

test('defaultTokenCachePath lives at the msm-re root', () => {
  const path = defaultTokenCachePath();
  assert.match(path, /\.auth-token\.json$/);
  assert.match(path, /msm-re/);
  assert.doesNotMatch(path, /node_modules/);
});