// Angular (any version with standalone or NgModule apps). The hosted script is framework-agnostic;
// this service only boots it, keeps screen context in sync with the router and shuts it down on sign-out.
//
// 1. Add the loader snippet to src/index.html <head> (see examples/web/index.html), or load the
//    script in angular.json "scripts". Nothing to npm install.
// 2. Add the gateway origin to your CSP script-src and connect-src.
// 3. Inject SupportCopilotService once, e.g. in AppComponent's constructor, and call start().
import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, Subscription } from 'rxjs';

declare global {
  interface Window {
    FisCopilot: ((command: string, arg?: unknown) => unknown) & { q?: unknown[] };
  }
}

@Injectable({ providedIn: 'root' })
export class SupportCopilotService implements OnDestroy {
  private sub?: Subscription;

  constructor(private router: Router, private zone: NgZone) {}

  start(opts: { gatewayUrl: string; appId: string; appMnemonic: string; namespace: string; getToken?: () => Promise<string | null> }) {
    // Run outside Angular so the widget's streaming doesn't trigger change detection on every token.
    this.zone.runOutsideAngular(() => {
      window.FisCopilot('boot', {
        ...opts,
        title: 'Support Copilot',
        getContext: () => ({ route: this.router.url }),
      });
    });
    this.sub = this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => window.FisCopilot('update', { screen: document.title, error: null })); // new screen, old error no longer applies
  }

  // Call from your HttpInterceptor / ErrorHandler, or from an error banner component.
  reportError(err: { code?: string; message: string; jobName?: string }) {
    window.FisCopilot('error', err);
  }

  ask(question: string) {
    window.FisCopilot('open');
    window.FisCopilot('ask', question);
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
    window.FisCopilot('shutdown');
  }
}

// app.component.ts
//
//   export class AppComponent {
//     constructor(copilot: SupportCopilotService, auth: AuthService) {
//       copilot.start({
//         gatewayUrl: environment.copilotGatewayUrl,
//         appId: 'eagle-star',
//         appMnemonic: 'ESR',
//         namespace: 'fund-accounting/eagle-star',
//         getToken: () => auth.getAccessToken('api://fis-copilot/.default'),
//       });
//     }
//   }
//
// "Ask the copilot" from an error banner:
//   <button (click)="copilot.reportError({ code: job.errorCode, message: job.error, jobName: job.name });
//                    copilot.ask('Why did ' + job.name + ' fail?')">Ask support copilot</button>
//
// Global capture: provide an ErrorHandler that calls copilot.reportError({ code: e.name, message: e.message }).
// Uncaught errors and unhandled rejections are also captured automatically unless captureErrors: false.
