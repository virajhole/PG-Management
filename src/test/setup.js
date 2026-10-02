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

/**
 * WAAPI stand-in for the browser-like environment.
 *
 * Every enter/exit transition in the UI goes through motion's
 * `element.animate(...)`, and motion awaits the returned `animation.finished`.
 * happy-dom rejects that promise with an AbortError as soon as a test unmounts
 * mid-animation, which nobody handles - Vitest then reports it as an unhandled
 * error and fails an otherwise green run. A stub that settles instead of
 * rejecting keeps the suite testing behaviour rather than teardown timing,
 * without touching what the components actually render.
 */
if (typeof window !== 'undefined' && window.Element?.prototype) {
  const elementProto = window.Element.prototype;
  if (!elementProto.__pgmAnimateStubbed) {
    Object.defineProperty(elementProto, '__pgmAnimateStubbed', { value: true });
    elementProto.animate = function animateStub() {
      let settle;
      const finished = new Promise((resolve) => {
        settle = resolve;
      });
      const animation = {
        finished,
        cancel() {},
        finish() {
          settle({ currentTime: 0 });
        },
        pause() {},
        play() {},
        persist() {},
        reverse() {},
        addEventListener() {},
        removeEventListener() {},
        onfinish: null,
        oncancel: null,
        startTime: 0,
        currentTime: 0,
        playbackRate: 1,
        playState: 'finished',
        effect: null,
        timeline: null,
        id: '',
      };
      // Settle on the microtask queue so callers that `await` it still resolve,
      // but nothing is left dangling when the test tears down.
      Promise.resolve().then(() => {
        animation.playState = 'finished';
        settle({ currentTime: 0 });
      });
      return animation;
    };
  }
}
