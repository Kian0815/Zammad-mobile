import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

const queryClient = new QueryClient();
const baseUrl = import.meta.env.BASE_URL;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const expectedScope = new URL(baseUrl, window.location.origin).toString();
    const expectedScript = new URL(`${baseUrl}sw.js`, window.location.origin).toString();

    navigator.serviceWorker.getRegistrations()
      .then(async (registrations) => {
        for (const registration of registrations) {
          const scriptUrl = registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL || '';
          const sameOrigin = registration.scope.startsWith(window.location.origin);
          const looksLikeThisApp = scriptUrl.includes('/sw.js') && (registration.scope.includes('/zammad') || registration.scope === `${window.location.origin}/`);

          if (sameOrigin && looksLikeThisApp && (registration.scope !== expectedScope || scriptUrl !== expectedScript)) {
            await registration.unregister();
          }
        }
      })
      .catch((error) => {
        console.error('Service worker cleanup failed', error);
      })
      .finally(() => {
        navigator.serviceWorker.register(`${baseUrl}sw.js`)
          .then((registration) => registration.update())
          .catch((error) => {
            console.error('Service worker registration failed', error);
          });
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={baseUrl}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
