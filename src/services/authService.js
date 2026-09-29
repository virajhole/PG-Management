import { readJSON, writeJSON, KEYS } from './localStore.js';

/**
 * A very small gate in front of ID documents.
 *
 * The PIN is stored only as a salted SHA-256 digest (Web Crypto), never in
 * clear text. This is deliberately modest: anyone with devtools on the device
 * can still get at IndexedDB. It stops casual shoulder-surfing, nothing more.
 * See the README for what to do before putting real Aadhaar/PAN data in here.
 */

const SESSION_KEY = KEYS.session;
const PIN_KEY = 'pgm.pin.v1';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export const DEFAULT_PIN = '1234';

function randomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function isPinConfigured() {
  return Boolean(readJSON(PIN_KEY, null));
}

export async function setPin(pin) {
  const salt = randomSalt();
  const hash = await hashPin(pin, salt);
  writeJSON(PIN_KEY, { salt, hash });
  return true;
}

export async function verifyPin(pin) {
  const record = readJSON(PIN_KEY, null);
  // First run: any 4-6 digit PIN works and is then stored as the real one.
  if (!record) {
    await setPin(pin);
    return true;
  }
  const hash = await hashPin(pin, record.salt);
  return hash === record.hash;
}

export function readSession() {
  const session = readJSON(SESSION_KEY, null);
  if (!session?.expiresAt) return null;
  if (Date.now() > session.expiresAt) {
    clearSession();
    return null;
  }
  return session;
}

export function startSession() {
  const session = { authenticatedAt: new Date().toISOString(), expiresAt: Date.now() + SESSION_TTL_MS };
  writeJSON(SESSION_KEY, session);
  return session;
}

export function clearSession() {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
