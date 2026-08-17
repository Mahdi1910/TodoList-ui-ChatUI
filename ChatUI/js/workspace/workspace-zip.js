/**
 * workspace-zip.js - Minimal standards-compliant UTF-8 stored-ZIP reader/writer.
 *
 * Workspace backups deliberately use method 0 (stored, no compression). This
 * keeps the format transparent and lets restore reject unsupported/archive-bomb
 * compression before any Workspace mutation occurs.
 */

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const STORED_METHOD = 0;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

let crcTable = null;
function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

export function crc32(bytes) {
  const table = getCrcTable();
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function uint16(view, offset, value) { view.setUint16(offset, value, true); }
function uint32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

function concat(chunks, totalLength) {
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function normalizedEntry(entry) {
  const name = String(entry?.name || '');
  const directory = Boolean(entry?.directory || name.endsWith('/'));
  const normalizedName = directory && !name.endsWith('/') ? `${name}/` : name;
  const data = directory
    ? new Uint8Array(0)
    : entry?.data instanceof Uint8Array
      ? entry.data
      : encoder.encode(String(entry?.data ?? ''));
  return { name: normalizedName, nameBytes: encoder.encode(normalizedName), directory, data, crc: crc32(data) };
}

export function createStoredZip(entries = []) {
  const normalized = entries.map(normalizedEntry);
  if (normalized.length > 0xFFFF) throw new Error('ZIP entry count exceeds the non-Zip64 limit.');

  const localChunks = [];
  const centralChunks = [];
  let localOffset = 0;

  for (const entry of normalized) {
    if (!entry.name || entry.nameBytes.byteLength > 0xFFFF) throw new Error('ZIP entry name is invalid or too long.');
    if (entry.data.byteLength > 0xFFFFFFFF) throw new Error('ZIP entry is too large.');

    const localHeader = new Uint8Array(30 + entry.nameBytes.byteLength);
    const localView = new DataView(localHeader.buffer);
    uint32(localView, 0, LOCAL_SIGNATURE);
    uint16(localView, 4, 20);
    uint16(localView, 6, UTF8_FLAG);
    uint16(localView, 8, STORED_METHOD);
    uint16(localView, 10, 0);
    uint16(localView, 12, 0);
    uint32(localView, 14, entry.crc);
    uint32(localView, 18, entry.data.byteLength);
    uint32(localView, 22, entry.data.byteLength);
    uint16(localView, 26, entry.nameBytes.byteLength);
    uint16(localView, 28, 0);
    localHeader.set(entry.nameBytes, 30);
    localChunks.push(localHeader, entry.data);

    const central = new Uint8Array(46 + entry.nameBytes.byteLength);
    const centralView = new DataView(central.buffer);
    uint32(centralView, 0, CENTRAL_SIGNATURE);
    uint16(centralView, 4, 20);
    uint16(centralView, 6, 20);
    uint16(centralView, 8, UTF8_FLAG);
    uint16(centralView, 10, STORED_METHOD);
    uint16(centralView, 12, 0);
    uint16(centralView, 14, 0);
    uint32(centralView, 16, entry.crc);
    uint32(centralView, 20, entry.data.byteLength);
    uint32(centralView, 24, entry.data.byteLength);
    uint16(centralView, 28, entry.nameBytes.byteLength);
    uint16(centralView, 30, 0);
    uint16(centralView, 32, 0);
    uint16(centralView, 34, 0);
    uint16(centralView, 36, 0);
    uint32(centralView, 38, entry.directory ? 0x10 : 0);
    uint32(centralView, 42, localOffset);
    central.set(entry.nameBytes, 46);
    centralChunks.push(central);

    localOffset += localHeader.byteLength + entry.data.byteLength;
  }

  const centralSize = centralChunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  uint32(eocdView, 0, EOCD_SIGNATURE);
  uint16(eocdView, 4, 0);
  uint16(eocdView, 6, 0);
  uint16(eocdView, 8, normalized.length);
  uint16(eocdView, 10, normalized.length);
  uint32(eocdView, 12, centralSize);
  uint32(eocdView, 16, localOffset);
  uint16(eocdView, 20, 0);

  const totalLength = localOffset + centralSize + eocd.byteLength;
  return concat([...localChunks, ...centralChunks, eocd], totalLength);
}

function findEocd(bytes) {
  const minimum = Math.max(0, bytes.byteLength - 22 - 0xFFFF);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function ensureRange(bytes, offset, length, label) {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) throw new Error(`${label} exceeds the ZIP file bounds.`);
}

export function readStoredZip(input, options = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const maxEntries = Math.max(1, Number(options.maxEntries) || 10000);
  const maxTotalBytes = Math.max(1, Number(options.maxTotalBytes) || 100 * 1024 * 1024);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEocd(bytes);
  if (eocdOffset < 0) throw new Error('ZIP end-of-central-directory record was not found.');

  const disk = view.getUint16(eocdOffset + 4, true);
  const centralDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) throw new Error('Multi-disk ZIP archives are not supported.');
  if (totalEntries === 0xFFFF || centralSize === 0xFFFFFFFF || centralOffset === 0xFFFFFFFF) throw new Error('Zip64 Workspace backups are not supported.');
  if (totalEntries > maxEntries) throw new Error(`Workspace backup exceeds the ${maxEntries} entry limit.`);
  ensureRange(bytes, centralOffset, centralSize, 'ZIP central directory');

  const entries = [];
  const seen = new Set();
  let totalUncompressed = 0;
  let offset = centralOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    ensureRange(bytes, offset, 46, 'ZIP central directory entry');
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) throw new Error('ZIP central directory entry is invalid.');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const expectedCrc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const externalAttrs = view.getUint32(offset + 38, true);
    const localOffset = view.getUint32(offset + 42, true);
    const fullLength = 46 + nameLength + extraLength + commentLength;
    ensureRange(bytes, offset, fullLength, 'ZIP central directory entry');

    if (method !== STORED_METHOD) throw new Error('Workspace backup uses an unsupported compressed ZIP entry.');
    if (compressedSize !== uncompressedSize) throw new Error('Stored ZIP entry size metadata is inconsistent.');
    if ((externalAttrs >>> 16 & 0xF000) === 0xA000) throw new Error('Symbolic links are not allowed in Workspace backups.');
    if (!(flags & UTF8_FLAG) && nameLength > 0) {
      // ASCII remains valid UTF-8. Non-UTF8 legacy encodings are intentionally not supported.
    }

    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    let name;
    try { name = decoder.decode(nameBytes); }
    catch (_) { throw new Error('Workspace backup contains an invalid UTF-8 entry name.'); }
    if (!name || seen.has(name)) throw new Error('Workspace backup contains an empty or duplicate ZIP path.');
    seen.add(name);

    ensureRange(bytes, localOffset, 30, 'ZIP local header');
    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) throw new Error('ZIP local entry header is invalid.');
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    ensureRange(bytes, dataOffset, compressedSize, 'ZIP entry data');
    const data = bytes.slice(dataOffset, dataOffset + compressedSize);
    if (crc32(data) !== expectedCrc) throw new Error(`ZIP entry CRC check failed for ${name}.`);

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > maxTotalBytes) throw new Error(`Workspace backup exceeds the ${Math.floor(maxTotalBytes / 1024 / 1024)} MiB uncompressed limit.`);
    entries.push({ name, directory: name.endsWith('/'), data, uncompressedSize, externalAttrs });
    offset += fullLength;
  }

  if (offset !== centralOffset + centralSize) throw new Error('ZIP central directory size does not match its entries.');
  return { entries, totalUncompressedBytes: totalUncompressed };
}