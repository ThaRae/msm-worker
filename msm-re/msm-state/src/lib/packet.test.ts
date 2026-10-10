/**
 * Round-trip tests for the SFS codec and game packet framing, exercising
 * the details reversed from MSM_native.exe: big-endian scalars, sorted
 * object keys, and optional payload object in packets.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { newSfsArray, newSfsObject, decodeValue, encodeObject, isSfsObject, isSfsArray } from './sfs.js';
import { newShort } from '../types/sfs.js';
import { encodePacket, decodePacket } from './packet.js';
import type { SfsObject, SfsValue } from '../types/sfs.js';

function sampleLoginObject(): SfsObject {
  const data = newSfsObject();
  data.entries.set('client_version', '5.7.0');
  data.entries.set('attempt_recovery', false);
  data.entries.set('last_command_id', 9007199254740993n);
  data.entries.set('nested', newSfsObject());
  data.entries.set('blob', new Uint8Array([0xde, 0xad]));

  const login = newSfsObject();
  login.entries.set('zone', 'MySingingMonsters');
  login.entries.set('user', 'example-user-game-id');
  login.entries.set('data', data);
  return login;
}

function expectObject(value: SfsValue | undefined, key: string): SfsObject {
  if (value === undefined || !isSfsObject(value)) {
    assert.fail(`key ${key} is missing or not an object`);
  }
  return value;
}

test('object keys encode in sorted order with tag 18', () => {
  const bytes = encodeObject(sampleLoginObject());
  assert.equal(bytes[0], 18);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const keyCount = view.getUint16(1, false);
  assert.equal(keyCount, 3);
  // 'data' sorts before 'user' before 'zone' (std::map ordering).
  // Layout: tag(1) + keyCount(2) + keylen(2) then the key itself.
  assert.equal(new TextDecoder().decode(bytes.subarray(5, 9)), 'data');
});

test('encode/decode object round trip preserves values', () => {
  const original = sampleLoginObject();
  const bytes = encodeObject(original);
  const decoded = decodeValue(bytes, 0);
  assert.equal(decoded.offset, bytes.length);

  const login = expectObject(decoded.value, 'root');
  assert.equal(login.entries.get('user'), 'example-user-game-id');
  const data = expectObject(login.entries.get('data'), 'data');
  assert.equal(data.entries.get('client_version'), '5.7.0');
  assert.equal(data.entries.get('attempt_recovery'), false);
  assert.equal(data.entries.get('last_command_id'), 9007199254740993n);
  const blob = data.entries.get('blob');
  assert.ok(blob instanceof Uint8Array);
  assert.deepEqual([...blob], [0xde, 0xad]);
});

test('nested arrays round trip through SfsArray', () => {
  const arr = newSfsArray();
  arr.items.push(1n);
  arr.items.push('two');
  arr.items.push(newSfsObject());

  const outer = newSfsObject();
  outer.entries.set('list', arr);
  const bytes = encodeObject(outer);
  const decoded = decodeValue(bytes, 0);

  const root = expectObject(decoded.value, 'root');
  const list = root.entries.get('list');
  assert.ok(list !== undefined && isSfsArray(list));
  assert.deepEqual(
    list.items.map((item) => typeof item),
    ['bigint', 'string', 'object'],
  );
});

test('packet round trip with seq prefix', () => {
  const bytes = encodePacket(42n, 'USER_LOGIN', sampleLoginObject());
  const packet = decodePacket(bytes);
  assert.equal(packet.seq, 42n);
  assert.equal(packet.cmd, 'USER_LOGIN');
  const login = expectObject(packet.data, 'payload');
  assert.equal(login.entries.get('user'), 'example-user-game-id');
});

test('keep_alive frame decodes with no payload object', () => {
  const bytes = encodePacket(2n, 'keep_alive');
  const packet = decodePacket(bytes);
  assert.equal(packet.cmd, 'keep_alive');
  assert.equal(packet.data, undefined);
});

test('SFSData<short> encodes as tag 3 with a two-byte payload', () => {
  // The client's writer (case 3 at 0xE72C20) serializes SFSData<short>
  // as tag 3 plus a u16 big-endian; getting this wrong makes the server
  // handler throw and close the socket (close 1011 SERVER_PROCESS_ERROR).
  const obj = newSfsObject();
  obj.entries.set('time_mask', newShort(8));
  const bytes = encodeObject(obj);

  assert.equal(bytes[0], 18);
  // [tag 3][00 08] after "time_mask" (9 bytes) + u16 length prefix.
  const valueOffset = 1 + 2 + 2 + 9;
  assert.equal(bytes[valueOffset], 3);
  assert.equal(bytes[valueOffset + 1], 0);
  assert.equal(bytes[valueOffset + 2], 8);

  const decoded = decodeValue(bytes, 0);
  const root = expectObject(decoded.value, 'root');
  assert.equal(root.entries.get('time_mask'), 8);
});

test('action ids encode as longs (tag 5), the way the client sends them', () => {
  const obj = newSfsObject();
  obj.entries.set('user_monster_id', 386n);
  const bytes = encodeObject(obj);

  const valueOffset = 1 + 2 + 2 + 15;
  assert.equal(bytes[valueOffset], 5);
  assert.equal(Number(new DataView(bytes.buffer).getBigUint64(valueOffset + 1, false)), 386);

  const decoded = decodeValue(bytes, 0);
  const root = expectObject(decoded.value, 'root');
  assert.equal(root.entries.get('user_monster_id'), 386n);
});