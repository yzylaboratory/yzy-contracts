import { addEventProcessor, getReplay, init, makeFetchTransport, replayIntegration } from "@sentry/browser";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

function safeReplayPage(value: string) {
  try {
    const url = new URL(value, window.location.origin);
    const section = url.pathname.split("/")[1];
    const knownSections = [
      "administracion", "clientes", "configuracion", "contratos", "dashboard",
      "directorio-clientes", "docs-generados", "empresas", "facturacion",
    ];
    return url.origin === window.location.origin && knownSections.includes(section)
      ? `${window.location.origin}/${section}`
      : window.location.origin;
  } catch {
    return window.location.origin;
  }
}

function canRecordPage() {
  if (typeof window === "undefined") return false;
  const { pathname, search, hash } = window.location;
  return pathname !== "/" && !/^\/(?:auth|login|preacceso|prospecto)(?:\/|$)/.test(pathname) && !search && !hash;
}

let initialized = false;
let recordingAllowed = false;

function getSentryEnvironment(): string {
  if (typeof window !== "undefined" && window.location.hostname === "yzycontracts.yzylabs.dev") {
    return "development";
  }
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

function initializeReplay() {
  if (!dsn || !canRecordPage()) return;
  // Keep the integration optional and prevent a monitoring failure from breaking the portal.
  try {
    init({
      dsn,
      environment: getSentryEnvironment(),
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1,
      transport(options) {
        const transport = makeFetchTransport(options);
        return {
          ...transport,
          send(envelope) {
            const recording = envelope[1].find(([header]) => header.type === "replay_recording");
            if (!recording) return transport.send(envelope);
            // Replay's metadata snapshot records the full URL. Normalize it before upload.
            try {
              const [header, payload] = recording;
              if (typeof payload !== "string") return Promise.resolve({});
              const separator = payload.indexOf("\n");
              const events: { type: number; data?: { href?: string } }[] = JSON.parse(payload.slice(separator + 1));
              for (const event of events) {
                if (event.type === 4 && typeof event.data?.href === "string") {
                  event.data.href = safeReplayPage(event.data.href);
                }
              }
              const scrubbed = payload.slice(0, separator + 1) + JSON.stringify(events);
              recording[0] = { ...header, length: new TextEncoder().encode(scrubbed).length };
              recording[1] = scrubbed;
              return transport.send(envelope);
            } catch {
              return Promise.resolve({});
            }
          },
        };
      },
      integrations: (defaults) => [
        ...defaults.filter(integration => integration.name !== "Breadcrumbs"),
        replayIntegration({
          useCompression: false,
          maskAllText: true,
          maskAllInputs: true,
          blockAllMedia: true,
          block: ["iframe", "canvas", "a[href*='?']", "a[href*='#']"],
          maskAttributes: ["title", "placeholder", "aria-label", "alt", "download", "href", "action"],
          networkCaptureBodies: false,
          stickySession: false,
          maxReplayDuration: 5 * 60 * 1000,
          beforeAddRecordingEvent: () => null,
          beforeErrorSampling: canRecordPage,
        }),
      ],
      beforeSend(event) {
        if (!canRecordPage()) return null;
        delete event.request;
        delete event.user;
        delete event.breadcrumbs;
        delete event.extra;
        delete event.message;
        for (const exception of event.exception?.values ?? []) {
          // Error messages can contain form values; retain the type and code location.
          delete exception.value;
          for (const frame of exception.stacktrace?.frames ?? []) {
            if (frame.filename) {
              const asset = frame.filename.match(/\/_next\/static\/[\w/.-]+/)?.[0];
              frame.filename = asset ? window.location.origin + asset : "<anonymous>";
            }
          }
        }
        return event.exception?.values?.length ? event : null;
      },
    });
    addEventProcessor(event => {
      if (event.type === "replay_event") {
        delete event.request;
        delete event.user;
        if ("urls" in event && Array.isArray(event.urls)) event.urls = event.urls.map(safeReplayPage);
      }
      return event;
    });
    initialized = true;
    recordingAllowed = true;
  } catch {
    // Monitoring should never prevent the portal from starting.
  }
}

export function updatePortalReplay() {
  if (!initialized) {
    initializeReplay();
    return;
  }
  const allowed = canRecordPage();
  if (allowed === recordingAllowed) return;
  recordingAllowed = allowed;
  const replay = getReplay();
  if (!replay) return;
  if (allowed) replay.startBuffering();
  else void replay.stop().catch(() => undefined);
}

updatePortalReplay();
