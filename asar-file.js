"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MAX_HEADER_BYTES = 64 * 1024 * 1024;

function fail(message) {
  throw new Error(`asar-file: ${message}`);
}

function readExact(fd, buffer, position, label) {
  let done = 0;
  while (done < buffer.length) {
    const count = fs.readSync(fd, buffer, done, buffer.length - done, position + done);
    if (!count) fail(`unexpected end of archive while reading ${label}`);
    done += count;
  }
  return buffer;
}

function readHeader(archivePath) {
  const archive = path.resolve(String(archivePath || ""));
  const stat = fs.statSync(archive);
  if (!stat.isFile()) fail(`not a file: ${archive}`);
  if (stat.size < 16) fail(`archive is too small: ${archive}`);

  const fd = fs.openSync(archive, "r");
  try {
    const prelude = readExact(fd, Buffer.alloc(16), 0, "header prelude");
    const outerPayloadSize = prelude.readUInt32LE(0);
    const headerSize = prelude.readUInt32LE(4);
    const innerPayloadSize = prelude.readUInt32LE(8);
    const jsonSize = prelude.readUInt32LE(12);

    if (outerPayloadSize !== 4) fail(`unsupported outer header size ${outerPayloadSize}`);
    if (headerSize < 8 || headerSize > MAX_HEADER_BYTES) {
      fail(`invalid header size ${headerSize}`);
    }
    if (innerPayloadSize + 4 !== headerSize) {
      fail(`inconsistent header sizes ${headerSize}/${innerPayloadSize}`);
    }
    if (jsonSize > innerPayloadSize - 4) fail(`invalid JSON header size ${jsonSize}`);

    const dataOffset = 8 + headerSize;
    if (dataOffset > stat.size) fail("header extends past the archive");
    const json = readExact(fd, Buffer.alloc(jsonSize), 16, "JSON header").toString("utf8");
    let header;
    try {
      header = JSON.parse(json);
    } catch (error) {
      fail(`invalid JSON header: ${error.message}`);
    }
    if (!header || typeof header !== "object" || !header.files || typeof header.files !== "object") {
      fail("header has no files table");
    }
    return { archive, dataOffset, header, size: stat.size };
  } finally {
    fs.closeSync(fd);
  }
}

function normalizeEntryPath(entryPath) {
  const raw = String(entryPath || "");
  if (!raw || raw.includes("\0")) fail("entry path is empty or contains NUL");
  if (raw.includes("\\")) fail(`entry path must use forward slashes: ${raw}`);
  if (path.posix.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) {
    fail(`absolute entry path is not allowed: ${raw}`);
  }
  const parts = raw.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    fail(`unsafe entry path: ${raw}`);
  }
  return parts;
}

function resolveEntry(header, entryPath) {
  const parts = normalizeEntryPath(entryPath);
  let files = header.files;
  let entry = null;
  for (let i = 0; i < parts.length; i++) {
    entry = files && files[parts[i]];
    if (!entry || typeof entry !== "object") fail(`entry not found: ${entryPath}`);
    if (i < parts.length - 1) {
      if (!entry.files || typeof entry.files !== "object") fail(`not a directory: ${parts.slice(0, i + 1).join("/")}`);
      files = entry.files;
    }
  }
  if (entry.files) fail(`entry is a directory: ${entryPath}`);
  if (entry.link) fail(`linked entries are not supported: ${entryPath}`);
  return { entry, parts };
}

function integer(value, label) {
  const raw = typeof value === "number" ? String(value) : String(value || "");
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) fail(`invalid ${label}: ${raw || "<empty>"}`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) fail(`${label} exceeds the safe integer range`);
  return parsed;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function verifyIntegrity(buffer, entry, entryPath) {
  const integrity = entry.integrity;
  if (!integrity) return;
  const algorithm = String(integrity.algorithm || "").replace(/-/g, "").toUpperCase();
  if (algorithm !== "SHA256") fail(`unsupported integrity algorithm for ${entryPath}: ${integrity.algorithm}`);
  const expected = String(integrity.hash || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) fail(`invalid SHA-256 integrity hash for ${entryPath}`);
  const actual = sha256(buffer);
  if (actual !== expected) fail(`SHA-256 mismatch for ${entryPath}`);

  if (Array.isArray(integrity.blocks)) {
    const blockSize = integer(integrity.blockSize, `integrity block size for ${entryPath}`);
    if (blockSize < 1) fail(`invalid integrity block size for ${entryPath}`);
    const expectedBlocks = Math.ceil(buffer.length / blockSize);
    if (integrity.blocks.length !== expectedBlocks) fail(`integrity block count mismatch for ${entryPath}`);
    for (let i = 0; i < integrity.blocks.length; i++) {
      const expectedBlock = String(integrity.blocks[i] || "").toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(expectedBlock)) fail(`invalid block hash ${i} for ${entryPath}`);
      const actualBlock = sha256(buffer.subarray(i * blockSize, Math.min(buffer.length, (i + 1) * blockSize)));
      if (actualBlock !== expectedBlock) fail(`SHA-256 block mismatch ${i} for ${entryPath}`);
    }
  }
}

function readUnpackedFile(archive, parts, entry, entryPath) {
  const root = path.resolve(`${archive}.unpacked`);
  const source = path.resolve(root, ...parts);
  if (source !== root && !source.startsWith(root + path.sep)) fail(`unpacked entry escaped its root: ${entryPath}`);
  const stat = fs.lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`unpacked entry is not a regular file: ${entryPath}`);
  const size = integer(entry.size, `size for ${entryPath}`);
  if (stat.size !== size) fail(`size mismatch for ${entryPath}: expected ${size}, got ${stat.size}`);
  return fs.readFileSync(source);
}

function readPackedFile(meta, entry, entryPath) {
  const size = integer(entry.size, `size for ${entryPath}`);
  const offset = integer(entry.offset, `offset for ${entryPath}`);
  const start = meta.dataOffset + offset;
  const end = start + size;
  if (!Number.isSafeInteger(end) || start < meta.dataOffset || end > meta.size) {
    fail(`entry extends past the archive: ${entryPath}`);
  }
  const fd = fs.openSync(meta.archive, "r");
  try {
    return readExact(fd, Buffer.alloc(size), start, entryPath);
  } finally {
    fs.closeSync(fd);
  }
}

function readEntry(meta, entryPath) {
  const { entry, parts } = resolveEntry(meta.header, entryPath);
  const buffer = entry.unpacked
    ? readUnpackedFile(meta.archive, parts, entry, entryPath)
    : readPackedFile(meta, entry, entryPath);
  if (buffer.length !== integer(entry.size, `size for ${entryPath}`)) {
    fail(`short read for ${entryPath}`);
  }
  verifyIntegrity(buffer, entry, entryPath);
  return { buffer, entry };
}

function readFile(archivePath, entryPath) {
  return readEntry(readHeader(archivePath), entryPath).buffer;
}

function sameDestination(destination, buffer, entry) {
  try {
    const stat = fs.lstatSync(destination);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== buffer.length) return false;
    const expected = entry.integrity && String(entry.integrity.hash || "").toLowerCase();
    if (/^[0-9a-f]{64}$/.test(expected)) return sha256(fs.readFileSync(destination)) === expected;
    return fs.readFileSync(destination).equals(buffer);
  } catch {
    return false;
  }
}

function writeAtomic(destinationPath, buffer, entry) {
  if (!destinationPath) fail("destination path is empty");
  const destination = path.resolve(String(destinationPath || ""));
  const parent = path.dirname(destination);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (sameDestination(destination, buffer, entry)) {
    fs.chmodSync(destination, 0o600);
    return false;
  }

  const temp = path.join(parent, `.${path.basename(destination)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    let written = 0;
    while (written < buffer.length) {
      const count = fs.writeSync(fd, buffer, written, buffer.length - written);
      if (!count) fail(`short write to ${temp}`);
      written += count;
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, destination);
    fs.chmodSync(destination, 0o600);
    return true;
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
    try { fs.unlinkSync(temp); } catch {}
    throw error;
  }
}

function extractFile(archivePath, entryPath, destinationPath) {
  const { buffer, entry } = readEntry(readHeader(archivePath), entryPath);
  const written = writeAtomic(destinationPath, buffer, entry);
  return { bytes: buffer.length, destination: path.resolve(destinationPath), written };
}

function main(argv) {
  if (argv.length !== 6 || argv[2] !== "extract-file") {
    console.error("usage: node asar-file.js extract-file <archive> <entry> <destination>");
    return 2;
  }
  try {
    const result = extractFile(argv[3], argv[4], argv[5]);
    console.log(`${result.written ? "extracted" : "verified"} ${argv[4]} (${result.bytes} bytes)`);
    return 0;
  } catch (error) {
    console.error(String(error && error.message || error));
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv);

module.exports = {
  extractFile,
  normalizeEntryPath,
  readFile,
  readHeader,
  resolveEntry,
  verifyIntegrity,
};
