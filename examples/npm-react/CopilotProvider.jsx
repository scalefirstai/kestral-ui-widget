// Modern SPA wrapper. The widget is framework-agnostic; this is ~20 lines of glue.
import { useEffect } from 'react';
import { init } from '@fis/support-copilot';

export function SupportCopilot({ gatewayUrl, appId, namespace, getToken, context }) {
  useEffect(() => {
    const copilot = init({ gatewayUrl, appId, namespace, getToken, getContext: () => context });
    return () => copilot.destroy();
    // Re-init only when the app identity changes; context is read lazily on each question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatewayUrl, appId, namespace]);
  return null;
}
