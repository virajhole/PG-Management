const KEY = 'pg-manager:notif-state';

/**
 * Read-state for the notification centre. Derived notifications are rebuilt
 * from live data on every load; only their *read* / dismissed flags persist,
 * keyed by a stable per-notification id.
 */
export function getStoredNotifs() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { read: [], dismissed: [] };
    const parsed = JSON.parse(raw);
    return {
      read: Array.isArray(parsed.read) ? parsed.read : [],
      dismissed: Array.isArray(parsed.dismissed) ? parsed.dismissed : [],
    };
  } catch {
    return { read: [], dismissed: [] };
  }
}

export function storeNotifs(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage blocked: unread state just won't persist */
  }
}

export function markNotifsRead(ids) {
  const state = getStoredNotifs();
  const set = new Set([...state.read, ...ids]);
  storeNotifs({ ...state, read: [...set] });
}

export function dismissNotifs(ids) {
  const state = getStoredNotifs();
  const readSet = new Set([...state.read, ...ids]);
  const dismissedSet = new Set([...state.dismissed, ...ids]);
  storeNotifs({ read: [...readSet], dismissed: [...dismissedSet] });
}

/** Forget everything (called when the underlying data changes in bulk). */
export function resetNotifs() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
