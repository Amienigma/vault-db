import { all, stats, json } from '../lib/store.js';
export async function GET() {
  try { return json(stats((await all()).flatMap(d => d.records).slice(0, 50000))); }
  catch (e) { return json({ error: String(e) }, 500); }
}
