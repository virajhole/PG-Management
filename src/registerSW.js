/**
 * Registers the service worker in production builds only.
 *
 * In dev, Vite serves modules the service worker would happily cache forever,
 * which makes hot reloads lie to you - so it stays off until `npm run build`.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((registration) => {
        // Pick up a new build as soon as the tab is focused again.
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              worker.postMessage('SKIP_WAITING');
            }
          });
        });
      })
      .catch((error) => {
        console.warn('[pwa] service worker registration failed:', error);
      });
  });
}

export function unregisterServiceWorker() {
  navigator.serviceWorker?.getRegistrations?.().then((registrations) => {
    registrations.forEach((registration) => registration.unregister());
  });
}
