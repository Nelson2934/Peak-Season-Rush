import { randomInt, randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/firebase.js';

// Hands out a one-time game session with a random seed.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  const id = randomUUID();
  const seed = randomInt(0, 2 ** 31);
  const now = Date.now();
  await db.collection('sessions').doc(id).set({
    seed,
    startedAt: Timestamp.fromMillis(now),
    expireAt: Timestamp.fromMillis(now + 3 * 60 * 60 * 1000), // auto-deleted by TTL policy
    used: false,
  });
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ id, seed });
}
