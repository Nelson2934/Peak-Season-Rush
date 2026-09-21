import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../lib/firebase.js';
import { verify, TICK } from '../game-core.js';

const NAME_OK = /^[\p{L}\p{N} .,'&-]{1,20}$/u;
const slug = n => n.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  res.setHeader('Cache-Control', 'no-store');

  const { sessionId, name: rawName, moves } = req.body || {};
  const name = typeof rawName === 'string' ? rawName.trim().replace(/\s+/g, ' ') : '';
  if (typeof sessionId !== 'string' || sessionId.length > 64) return res.status(400).json({ error: 'Bad session' });
  if (!NAME_OK.test(name) || !slug(name)) return res.status(400).json({ error: 'Use letters and numbers in your name (up to 20)' });
  if (!Array.isArray(moves) || moves.length > 400000) return res.status(400).json({ error: 'Bad replay' });

  const sessionRef = db.collection('sessions').doc(sessionId);
  const scoreRef = db.collection('scores').doc(slug(name));

  try {
    const result = await db.runTransaction(async tx => {
      // 1. All reads first
      const [sessionSnap, scoreSnap] = await Promise.all([tx.get(sessionRef), tx.get(scoreRef)]);
      if (!sessionSnap.exists) return { error: 'Session not found' };
      const s = sessionSnap.data();
      if (s.used) return { error: 'This game was already submitted' };

      // 2. Check the game (no database access)
      const r = verify(s.seed, moves);
      const realSecs = (Date.now() - s.startedAt.toMillis()) / 1000;
      let error = null;
      if (!r) error = 'Replay did not check out';
      else if (r.ticks * TICK > realSecs + 5) error = 'Game ran faster than real time';

      // 3. Writes last. The session is used up even if the check failed.
      tx.update(sessionRef, { used: true });
      if (error) return { error };

      const prevBest = scoreSnap.exists ? scoreSnap.data().score : 0;
      const isBest = r.score > prevBest;
      if (isBest && r.score > 0) {
        tx.set(scoreRef, { name, score: r.score, level: r.level, at: FieldValue.serverTimestamp() });
      }
      return { ...r, isBest, prevBest };
    });

    if (result.error) return res.status(400).json(result);
    res.status(200).json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not save score, please try again' });
  }
}
