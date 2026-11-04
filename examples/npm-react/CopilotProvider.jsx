// Modern SPA wrapper. The widget is framework-agnostic; this is ~20 lines of glue.
import { useEffect } from 'react';
import { init } from '@fis/support-copilot';

export function SupportCopilot({ gatewayUrl, appId, appMnemonic, namespace, getToken, context }) {
  // context: { screen, route, error: { code, message } | null, ...app keys }
  useEffect(() => {
    const copilot = init({ gatewayUrl, appId, appMnemonic, namespace, getToken, getContext: () => context });
    return () => copilot.destroy();
    // Re-init only when the app identity changes; context is read lazily on each question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatewayUrl, appId, appMnemonic, namespace]);
  return null;
}
