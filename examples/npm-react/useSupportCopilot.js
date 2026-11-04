// React with the hosted script (no npm package): add the loader snippet to public/index.html, then
// call this hook once near the root. Context follows the current route via FisCopilot('update').
import { useEffect } from 'react';

export function useSupportCopilot({ gatewayUrl, appId, appMnemonic, namespace, getToken, route, screen, error }) {
  useEffect(() => {
    window.FisCopilot('boot', { gatewayUrl, appId, appMnemonic, namespace, getToken });
    return () => window.FisCopilot('shutdown');
    // Re-boot only when the app identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatewayUrl, appId, appMnemonic, namespace]);

  useEffect(() => {
    window.FisCopilot('update', { route, screen: screen || document.title });
  }, [route, screen]);

  // error: { code, message, jobName } from your error boundary / API layer, or null when cleared.
  useEffect(() => {
    window.FisCopilot('error', error || null);
  }, [error]);
}
