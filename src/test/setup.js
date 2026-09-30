/**
 * Universal test setup - safe under both the `node` and `happy-dom`
 * environments. Only fills in globals that are genuinely missing, so the
 * browser-like environment is never clobbered.
 */

// Web Crypto, used by Supabase Auth's client under test.
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = await import('node:crypto');
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, writable: true, configurable: true });
}

/**
 * The service layer is written against `window.localStorage`, which is the
 * right target in a browser. The service tests run in the plain `node`
 * environment for speed, so give them a minimal Storage stand-in there. Under
 * `happy-dom` a real one already exists and this block is skipped.
 */
if (typeof globalThis.window === 'undefined') {
  const makeStorage = () => {
    const map = new Map();
    return {
      get length() {
        return map.size;
      },
      key: (index) => [...map.keys()][index] ?? null,
      getItem: (key) => (map.has(String(key)) ? map.get(String(key)) : null),
      setItem: (key, value) => void map.set(String(key), String(value)),
      removeItem: (key) => void map.delete(String(key)),
      clear: () => map.clear(),
    };
  };

  globalThis.window = { localStorage: makeStorage(), sessionStorage: makeStorage() };
}
