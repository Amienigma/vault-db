import { all, json } from '../lib/store.js';
export async function GET(req) {
  try {
    const q = (new URL(req.url).searchParams.get('q') || '').toLowerCase();
    const out = []; let n = 0;
    for (const d of await all()) {
      const recs = d.records.map((data, i) => ({ id: `${d.meta.id}-${i + 1}`, file_id: d.meta.id, data })).reverse();
      for (const r of recs) { if (q && !JSON.stringify(r.data).toLowerCase().includes(q)) continue; out.push({ id: ++n, file_id: r.file_id, data: r.data }); if (out.length >= 100) break; }
      if (out.length >= 100) break;
    }
    return json(out);
  } catch (e) { return json({ error: String(e) }, 500); }
}
