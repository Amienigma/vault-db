import { all, json } from '../lib/store.js';
export async function GET() {
  try { return json((await all()).map(d => { const { id, name, status, size_bytes, rows_loaded, rejected, error } = d.meta; return { id, name, status, size_bytes, rows_loaded, rejected, error }; })); }
  catch (e) { return json({ error: String(e) }, 500); }
}
