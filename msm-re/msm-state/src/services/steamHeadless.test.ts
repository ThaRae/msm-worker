/**
 * Steam refresh-token persistence: the JWT is equivalent to the account
 * password, so these pin down the roundtrip and the 0600 permission.
 * (The mint itself needs a live Steam connection and is verified live.)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadSteamRefreshToken,
  saveSteamRefreshToken,
  defaultSteamDataDir,
  defaultSteamTokenPath,
} from './steamHeadless.js';

function tmpTokenPath(name: string): string {
  return join(tmpdir(), `msm-steam-token-test-${process.pid}-${name}.json`);
}

test('save/load roundtrip preserves the JWT', () => {
  const path = tmpTokenPath('roundtrip');
  try {
    saveSteamRefreshToken(path, 'eyJhbGciOiJFUzI1NiJ9.fake.jwt');
    assert.equal(loadSteamRefreshToken(path), 'eyJhbGciOiJFUzI1NiJ9.fake.jwt');
  } finally {
    rmSync(path, { force: true });
  }
});

test('the steam token file is only readable by its owner (mode 600)', () => {
  const path = tmpTokenPath('mode');
  try {
    saveSteamRefreshToken(path, 'jwt');
    assert.equal(statSync(path).mode & 0o077, 0);
  } finally {
    rmSync(path, { force: true });
  }
});

test('loading a missing steam token returns undefined', () => {
  assert.equal(loadSteamRefreshToken(tmpTokenPath('missing')), undefined);
});

test('a steam token file without refresh_token is rejected, not empty', () => {
  const path = tmpTokenPath('malformed');
  try {
    writeFileSync(path, '{"saved_at":123}');
    assert.throws(() => loadSteamRefreshToken(path), /missing refresh_token/);
  } finally {
    rmSync(path, { force: true });
  }
});

test('default steam paths live at the msm-re root', () => {
  assert.match(defaultSteamTokenPath(), /\.steam-refresh-token\.json$/);
  assert.match(defaultSteamDataDir(), /\.steam-user-data$/);
  assert.match(defaultSteamDataDir(), /msm-re/);
  assert.doesNotMatch(defaultSteamTokenPath(), /node_modules/);
});