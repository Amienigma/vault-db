import { ingest, json } from '../lib/store.js';
export async function POST(req) {
  try {
    const fd = await req.formData(); const out = [];
    for (const [, f] of fd.entries()) if (typeof f === 'object' && f.arrayBuffer) out.push(await ingest(f.name, Buffer.from(await f.arrayBuffer())));
    return json(out);
  } catch (e) { return json({ error: String(e) }, 500); }
}
