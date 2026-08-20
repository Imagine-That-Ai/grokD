// Generic protobuf wire-format re-encoder.
// Parses all fields; recursively descends into nested messages (when the
// bytes form a valid canonical submessage); lets you rewrite string fields.

function readVarint(buf, pos) {
  let result = 0n, shift = 0n, p = pos;
  for (;;) {
    if (p >= buf.length) throw new Error("varint overrun");
    const b = buf[p++];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) return [Number(result), p];
    shift += 7n;
    if (shift > 63n) throw new Error("varint too long");
  }
}

// Returns array of {fieldNo, wireType, value: Buffer|BigInt} or null if not parseable
function tryParse(buf) {
  const fields = [];
  let pos = 0;
  while (pos < buf.length) {
    const start = pos;
    let tag;
    try { tag = readVarint(buf, pos); } catch { return null; }
    pos = tag[1];
    const fieldNo = tag[0] >>> 3;
    const wireType = tag[0] & 7;
    if (fieldNo === 0) return null;
    if (wireType === 0) {
      let v; try { v = readVarint(buf, pos); } catch { return null; }
      pos = v[1]; fields.push({ fieldNo, wireType, value: v[0] });
    } else if (wireType === 1) {
      if (pos + 8 > buf.length) return null;
      fields.push({ fieldNo, wireType, value: buf.subarray(pos, pos + 8) });
      pos += 8;
    } else if (wireType === 2) {
      let l; try { l = readVarint(buf, pos); } catch { return null; }
      pos = l[1];
      const len = l[0];
      if (pos + len > buf.length) return null;
      fields.push({ fieldNo, wireType, value: buf.subarray(pos, pos + len) });
      pos += len;
    } else if (wireType === 5) {
      if (pos + 4 > buf.length) return null;
      fields.push({ fieldNo, wireType, value: buf.subarray(pos, pos + 4) });
      pos += 4;
    } else {
      return null; // groups unsupported
    }
    if (pos === start) return null;
  }
  return fields;
}

function encodeVarint(v) {
  const out = [];
  let n = BigInt(v);
  do { let b = Number(n & 0x7fn); n >>= 7n; if (n > 0n) b |= 0x80; out.push(b); } while (n > 0n);
  return Buffer.from(out);
}

function encode(fields) {
  const parts = [];
  for (const f of fields) {
    parts.push(encodeVarint((f.fieldNo << 3) | f.wireType));
    if (f.wireType === 0) parts.push(encodeVarint(f.value));
    else parts.push(f.value);
  }
  return Buffer.concat(parts);
}

function isCanonicalSub(buf) {
  // try parse; nested messages are usually canonical
  const f = tryParse(buf);
  if (!f || f.length === 0) return false;
  // avoid treating random strings as messages: require at least one valid-looking tag and full consume (tryParse guarantees)
  // heuristics: reject if it decodes as clean utf8 printable string
  return true;
}

function looksLikeText(buf) {
  // if all bytes are printable ascii, treat as string not submessage
  let printable = 0;
  for (const b of buf) {
    if ((b >= 0x20 && b < 0x7f) || b === 0x0a || b === 0x09) printable++;
  }
  return buf.length > 0 && printable / buf.length > 0.9;
}

// rewriteFn(str) -> str|null (null = keep)
function rewriteProto(buf, rewriteFn, depth = 0) {
  const fields = tryParse(buf);
  if (!fields) return null;
  let changed = false;
  const out = fields.map((f) => {
    if (f.wireType === 2 && depth < 8) {
      const sub = f.value;
      if (looksLikeText(sub)) {
        const s = sub.toString("utf8");
        const r = rewriteFn(s);
        if (r != null && r !== s) { changed = true; return { ...f, value: Buffer.from(r, "utf8") }; }
        return f;
      }
      if (isCanonicalSub(sub)) {
        const rewritten = rewriteProto(sub, rewriteFn, depth + 1);
        if (rewritten) { changed = true; return { ...f, value: rewritten }; }
      }
    }
    return f;
  });
  if (!changed) return null;
  return encode(out);
}

module.exports = { tryParse, encode, rewriteProto };
