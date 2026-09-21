import { db } from '../lib/firebase.js';

export default async function handler(req, res) {
  const snap = await db.collection('scores').orderBy('score', 'desc').limit(10).get();
  const top = snap.docs.map(d => ({ id: d.id, name: d.get('name'), score: d.get('score') }));
  res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=30');
  res.status(200).json(top);
}
