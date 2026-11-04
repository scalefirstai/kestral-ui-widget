// Entry point for the hosted <script> bundle (dist/fis-copilot.js). Installs window.FisCopilot as a
// command function (see commands.js) that also carries the programmatic API (FisCopilot.init, VERSION),
// replays any calls queued by the loader snippet, and supports zero-code data-attribute embedding:
//
//   <script src="https://copilot-gw/widget/fis-copilot.js" data-gateway-url="https://copilot-gw"
//           data-app-id="eagle-star" data-app-mnemonic="ESR" data-namespace="fund-accounting/eagle-star" defer></script>
import { init, VERSION } from './index.js';
import { createCommandApi } from './commands.js';

(function install(w) {
  if (typeof w === 'undefined' || typeof document === 'undefined') return;
  const stub = w.FisCopilot;
  if (stub && stub.VERSION) return; // already loaded once on this page
  const queue = stub && Array.isArray(stub.q) ? stub.q.slice() : [];

  const FisCopilot = createCommandApi(init);
  FisCopilot.init = init;
  FisCopilot.VERSION = VERSION;
  w.FisCopilot = FisCopilot;

  const script = document.currentScript;
  const d = script && script.dataset;
  if (d && d.gatewayUrl && !queue.some((a) => a[0] === 'boot')) {
    queue.unshift([
      'boot',
      {
        gatewayUrl: d.gatewayUrl,
        appId: d.appId,
        appMnemonic: d.appMnemonic,
        namespace: d.namespace,
        title: d.title || undefined,
        subtitle: d.subtitle || '',
        position: d.position || undefined,
        colorScheme: d.colorScheme || undefined,
        theme: d.accent ? { accent: d.accent } : {},
        stream: d.stream !== 'false',
      },
    ]);
  }

  const run = () => FisCopilot.replay(queue);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})(typeof window !== 'undefined' ? window : undefined);
