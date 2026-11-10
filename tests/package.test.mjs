import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createZip } from '../scripts/zip.mjs';

/**
 * Minimal ZIP reader (central directory → entries) to verify the writer.
 * @param {Buffer} buf
 * @returns {Record<string, string>}
 */
function readZip(buf) {
  const eocd = buf.length - 22;
  expect(buf.readUInt32LE(eocd)).toBe(0x06054b50);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const body = buf.subarray(start, start + compSize);
    out[name] = (method === 8 ? inflateRawSync(body) : body).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe('createZip', () => {
  it('round-trips stored and deflated entries', () => {
    const entries = [
      { name: 'a.txt', data: Buffer.from('x') },
      { name: 'dir/b.json', data: Buffer.from('{"k":"' + 'v'.repeat(500) + '"}') },
    ];
    const files = readZip(createZip(entries));
    expect(Object.keys(files)).toEqual(['a.txt', 'dir/b.json']);
    expect(files['a.txt']).toBe('x');
    expect(files['dir/b.json']).toBe(entries[1].data.toString());
  });

  it('is deterministic', () => {
    const entries = [{ name: 'm.json', data: Buffer.from('{}') }];
    expect(createZip(entries).equals(createZip(entries))).toBe(true);
  });
});

describe('version consistency', () => {
  it('package.json and manifest.base.json versions match', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const manifest = JSON.parse(
      readFileSync(new URL('../src/manifest.base.json', import.meta.url), 'utf8'),
    );
    expect(manifest.version).toBe(pkg.version);
  });
});
