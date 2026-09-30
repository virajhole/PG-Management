import { useEffect, useState } from 'react';

/**
 * Tracks whether the browser currently believes it is online.
 *
 * Supabase is a network backend: reads fall back to whatever was already loaded,
 * but a write needs the connection. Components use this to show the offline
 * banner and to stop a payment button from pretending it succeeded.
 */
export function useOnlineStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}

export default useOnlineStatus;