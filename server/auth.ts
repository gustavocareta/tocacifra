import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './db.ts';

function loadSecret(): Buffer {
  if (process.env.SECRET) return Buffer.from(process.env.SECRET);
  const file = path.join(dataDir, 'secret');
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const s = crypto.randomBytes(32);
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}
const secret = loadSecret();

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 90;

export function signToken(uid: number): string {
  const payload = Buffer.from(JSON.stringify({ uid, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): number | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof uid === 'number' && exp > Date.now() ? uid : null;
  } catch {
    return null;
  }
}
