/**
 * Minimal, dependency-free ZIP writer (deflate) used to package the extension.
 *
 * Output is deterministic: entries are sorted by path and every entry carries
 * the same fixed DOS timestamp (1980-01-01 00:00), so the same input tree
 * always produces byte-identical archives.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

/** DOS date for 1980-01-01 ((year-1980)<<9 | month<<5 | day). */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

/**
 * @typedef {object} ZipEntry
 * @property {string} name  Forward-slash path inside the archive.
 * @property {Buffer} data  Uncompressed file contents.
 */

/**
 * Recursively collect files under `dir` as zip entries (sorted, POSIX paths).
 * @param {string} dir
 * @returns {Promise<ZipEntry[]>}
 */
export async function collectEntries(dir) {
  /** @type {ZipEntry[]} */
  const entries = [];
  /** @param {string} current */
  async function walk(current) {
    const items = await readdir(current, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) await walk(full);
      else if (item.isFile()) {
        const name = path.relative(dir, full).split(path.sep).join('/');
        entries.push({ name, data: await readFile(full) });
      }
    }
  }
  await walk(dir);
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return entries;
}

/**
 * Build a ZIP archive buffer from entries.
 * @param {ZipEntry[]} entries
 * @returns {Buffer}
 */
export function createZip(entries) {
  /** @type {Buffer[]} */
  const locals = [];
  /** @type {Buffer[]} */
  const centrals = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    // Store tiny/incompressible files uncompressed (method 0) when smaller.
    const useStore = deflated.length >= data.length;
    const body = useStore ? data : deflated;
    const method = useStore ? 0 : 8;
    const crc = crc32(data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    // extra len, comment len, disk start, internal attrs = 0
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, end]);
}
