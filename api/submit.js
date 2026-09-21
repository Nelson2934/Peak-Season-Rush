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
      const snap = await tx.get(sessionRef);
      if (!snap.exists) throw new Error('Session not found');
      const s = snap.data();
      if (s.used) throw new Error('This game was already submitted');
      tx.update(sessionRef, { used: true });

      const r = verify(s.seed, moves);
      if (!r) throw new Error('Replay did not check out');

      // The game can't have lasted longer than the real time since it started
      const realSecs = (Date.now() - s.startedAt.toMillis()) / 1000;
      if (r.ticks * TICK > realSecs + 5) throw new Error('Game ran faster than real time');

      const cur = await tx.get(scoreRef);
      const prevBest = cur.exists ? cur.data().score : 0;
      const isBest = r.score > prevBest;
      if (isBest && r.score > 0) {
        tx.set(scoreRef, { name, score: r.score, level: r.level, at: FieldValue.serverTimestamp() });
      }
      return { ...r, isBest, prevBest };
    });
    res.status(200).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save score' });
  }
}
