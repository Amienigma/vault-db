// Vercel port of the Vault DB pipeline (same rules as the Rust API, Scala worker and Haskell guard).
import { put, list, get, head } from '@vercel/blob';
import { createHash } from 'node:crypto';

const ACCESS = 'private';
const json = (v, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json' } });
export { json };

// --- Scala worker: CSV / JSON / JSONL parsing ---
function csvLine(s) {
  const out = []; let sb = ''; let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { sb += '"'; i++; } else q = false; } else sb += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(sb); sb = ''; }
    else sb += c;
  }
  out.push(sb); return out;
}
export function parse(name, text) {
  const n = name.toLowerCase();
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (n.endsWith('.jsonl') || n.endsWith('.ndjson')) return lines.map(l => JSON.parse(l));
  if (n.endsWith('.json')) { const v = JSON.parse(text); return Array.isArray(v) ? v : [v]; }
  if (!lines.length) return [];
  const h = csvLine(lines[0]);
  return lines.slice(1).map(l => { const o = {}; const v = csvLine(l); h.forEach((k, i) => { if (i < v.length) o[k] = v[i]; }); return o; });
}

// --- Haskell guard: normalise keys, drop null/empty fields, drop empty/non-object rows ---
const norm = k => k.trim().toLowerCase().replace(/[ -]/g, '_');
export function validate(rs) {
  const ok = [];
  for (const r of rs) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const o = {};
    for (const [k, v] of Object.entries(r)) if (v !== null && v !== '') o[norm(k)] = v;
    if (Object.keys(o).length) ok.push(o);
  }
  return { ok, rejected: rs.length - ok.length };
}

// --- storage: one blob per file holding its metadata + loaded records ---
const sha = buf => createHash('sha256').update(buf).digest('hex');
export async function ingest(name, buf) {
  name = (name || 'upload').replace(/\//g, '_');
  const hash = sha(buf);
  const key = `files/${hash}.json`;
  try { await head(key); return { name, duplicate: true }; } catch {}
  const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  await put(`uploads/${hash}-${name}`, buf, { access: ACCESS, addRandomSuffix: false });
  let meta = { id, name, sha256: hash, size_bytes: buf.length, status: 'loaded', rows_loaded: 0, rejected: 0, error: null, uploaded_at: new Date().toISOString() };
  let records = [];
  try {
    const { ok, rejected } = validate(parse(name, buf.toString('utf8')));
    records = ok; meta.rows_loaded = ok.length; meta.rejected = rejected;
  } catch (e) { meta.status = 'failed'; meta.error = String(e).slice(0, 300); }
  await put(key, JSON.stringify({ meta, records }), { access: ACCESS, addRandomSuffix: false, contentType: 'application/json' });
  return { name, id };
}

async function readJson(pathname) {
  const r = await get(pathname, { access: ACCESS, useCache: false });
  if (!r || r.statusCode !== 200) return null;
  return JSON.parse(await new Response(r.stream).text());
}
export async function all() {
  const blobs = []; let cursor;
  do { const r = await list({ prefix: 'files/', cursor, limit: 1000 }); blobs.push(...r.blobs); cursor = r.hasMore ? r.cursor : undefined; } while (cursor);
  const docs = (await Promise.all(blobs.map(b => readJson(b.pathname).catch(() => null)))).filter(Boolean);
  return docs.sort((a, b) => b.meta.id - a.meta.id);
}

// --- R stats ---
export function stats(recs) {
  if (!recs.length) return { total: 0, fields: [] };
  const keys = [...new Set(recs.flatMap(r => Object.keys(r)))];
  const fields = keys.map(k => {
    const v = recs.map(r => r[k]).filter(x => x !== undefined && x !== null);
    const num = v.map(x => (typeof x === 'number' ? x : (String(x).trim() === '' ? NaN : Number(x))));
    const good = num.filter(x => !Number.isNaN(x));
    if (v.length && good.length / v.length > 0.9) {
      const mean = good.reduce((a, b) => a + b, 0) / good.length;
      const sd = good.length > 1 ? Math.sqrt(good.reduce((a, b) => a + (b - mean) ** 2, 0) / (good.length - 1)) : null;
      return { field: k, type: 'numeric', n: v.length, mean: +mean.toFixed(3), min: Math.min(...good), max: Math.max(...good), sd: sd === null ? null : +sd.toFixed(3) };
    }
    const t = {}; for (const x of v) { const s = typeof x === 'object' ? JSON.stringify(x) : String(x); t[s] = (t[s] || 0) + 1; }
    const top = Object.fromEntries(Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 3));
    return { field: k, type: 'text', n: v.length, distinct: Object.keys(t).length, top };
  });
  return { total: recs.length, fields };
}
