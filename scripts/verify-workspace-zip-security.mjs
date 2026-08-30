import assert from 'node:assert/strict';
import { createStoredZip, readStoredZip } from '../ChatUI/js/workspace/workspace-zip.js';

const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const decoder = new TextDecoder();

function clone(bytes) {
  return new Uint8Array(bytes);
}

function findSignature(bytes, signature) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset <= bytes.byteLength - 4; offset += 1) {
    if (view.getUint32(offset, true) === signature) return offset;
  }
  return -1;
}

const valid = createStoredZip([
  { name: 'docs/', directory: true },
  { name: 'docs/note.md', data: '# Safe backup' }
]);
const parsed = readStoredZip(valid);
assert.equal(parsed.entries.length, 2);
assert.equal(parsed.entries[0].directory, true);
assert.equal(decoder.decode(parsed.entries[1].data), '# Safe backup');

assert.throws(
  () => readStoredZip(valid.slice(0, -10)),
  /end-of-central-directory|bounds/i,
  'truncated ZIP data must be rejected'
);

const crcBroken = createStoredZip([{ name: 'note.md', data: 'hello' }]);
const crcNameLength = new DataView(crcBroken.buffer).getUint16(26, true);
crcBroken[30 + crcNameLength] ^= 0x01;
assert.throws(() => readStoredZip(crcBroken), /CRC check failed/i, 'corrupted file data must fail CRC verification');

const compressed = clone(createStoredZip([{ name: 'note.md', data: 'hello' }]));
const compressedCentral = findSignature(compressed, CENTRAL_SIGNATURE);
new DataView(compressed.buffer).setUint16(compressedCentral + 10, 8, true);
assert.throws(() => readStoredZip(compressed), /unsupported compressed ZIP entry/i, 'compressed entries must be rejected');

const duplicate = createStoredZip([
  { name: 'same.md', data: 'one' },
  { name: 'same.md', data: 'two' }
]);
assert.throws(() => readStoredZip(duplicate), /duplicate ZIP path/i, 'duplicate paths must be rejected');

const tooMany = createStoredZip([
  { name: 'one.md', data: '1' },
  { name: 'two.md', data: '2' }
]);
assert.throws(() => readStoredZip(tooMany, { maxEntries: 1 }), /entry limit/i, 'entry-count limits must be enforced');
assert.throws(() => readStoredZip(createStoredZip([{ name: 'large.md', data: '123456' }]), { maxTotalBytes: 3 }), /uncompressed limit/i, 'uncompressed-size limits must be enforced');

const symlink = clone(createStoredZip([{ name: 'link.md', data: 'x' }]));
const symlinkCentral = findSignature(symlink, CENTRAL_SIGNATURE);
new DataView(symlink.buffer).setUint32(symlinkCentral + 38, 0xA0000000, true);
assert.throws(() => readStoredZip(symlink), /Symbolic links are not allowed/i, 'symlink entries must be rejected');

const zip64 = clone(createStoredZip([{ name: 'note.md', data: 'x' }]));
const eocd = findSignature(zip64, EOCD_SIGNATURE);
const zip64View = new DataView(zip64.buffer);
zip64View.setUint16(eocd + 8, 0xFFFF, true);
zip64View.setUint16(eocd + 10, 0xFFFF, true);
assert.throws(() => readStoredZip(zip64), /Zip64/i, 'Zip64 markers must be rejected');

const invalidUtf8 = clone(createStoredZip([{ name: 'aa', data: 'x' }]));
const utf8Central = findSignature(invalidUtf8, CENTRAL_SIGNATURE);
invalidUtf8[utf8Central + 46] = 0xC3;
invalidUtf8[utf8Central + 47] = 0x28;
assert.throws(() => readStoredZip(invalidUtf8), /invalid UTF-8 entry name/i, 'invalid UTF-8 paths must be rejected');

console.log('Workspace ZIP security regression verification passed.');
