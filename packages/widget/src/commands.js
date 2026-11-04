// Command API for the hosted script, in the style of Intercom's `Intercom('boot', …)`.
// Hosts can call it before the script has loaded: the loader snippet queues calls in FisCopilot.q
// and the bundle replays them in order once it runs.
//
//   FisCopilot('boot', { gatewayUrl, appId, namespace, getToken, … })
//   FisCopilot('update', { screen: 'NAV Dashboard', fundId: 'F12345' })   // merge screen context, e.g. on route change
//   FisCopilot('error', { code: 'ORA-00060', message: '…', jobName: 'ES_NAV_ACCRUALS' })  // error on screen; null clears
//   FisCopilot('open') | ('close') | ('ask', 'Why did the NAV job fail?') | ('reset')
//   FisCopilot('shutdown')                                                 // on sign-out
export function createCommandApi(init, warn = defaultWarn) {
  let instance = null;

  function FisCopilot(name, arg) {
    switch (name) {
      case 'boot':
        if (instance) instance.destroy();
        instance = init(arg || {});
        return instance;
      case 'shutdown':
        if (instance) instance.destroy();
        instance = null;
        return undefined;
      case 'update':
        if (instance) instance.update(arg || {});
        return undefined;
      case 'error':
        if (instance) instance.setError(arg);
        return undefined;
      case 'open':
      case 'close':
      case 'reset':
      case 'ask':
        if (!instance) return warn(`FisCopilot('${name}') called before 'boot'`);
        return instance[name](arg);
      default:
        return warn(`FisCopilot: unknown command '${name}'`);
    }
  }

  FisCopilot.replay = (queue) => {
    (queue || []).forEach((args) => {
      try {
        FisCopilot.apply(null, Array.prototype.slice.call(args));
      } catch (err) {
        warn(`FisCopilot: queued '${args && args[0]}' failed: ${err && err.message}`);
      }
    });
  };
  FisCopilot.instance = () => instance;
  return FisCopilot;
}

function defaultWarn(msg) {
  if (typeof console !== 'undefined') console.warn(msg);
}
