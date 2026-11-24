import '@fontsource-variable/vazirmatn';
import '@fontsource/noto-naskh-arabic/400.css';
import '@fontsource/noto-naskh-arabic/700.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './lib/auth';
import { BrandingProvider } from './lib/branding';
import { NotificationProvider } from './lib/notifications';

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <BrandingProvider>
          <NotificationProvider>
            <App />
          </NotificationProvider>
        </BrandingProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);

// The service worker is production-only: registering it in dev would serve
// stale hashed assets between HMR reloads.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // A page that is already controlled was loaded by the previous worker; if a
  // new worker later takes control, the document is still running the old
  // build while the new worker owns the caches. An installed iOS web app has
  // no reload button, so that state looks like a dead app: reload once.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    // updateViaCache: 'none' keeps an intermediate HTTP cache from pinning an
    // old worker script, which would freeze the app on an old build.
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {
      // Offline support is an enhancement; a failed registration must not break the app.
    });
  });
}
