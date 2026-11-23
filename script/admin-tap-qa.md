# Installed admin chat notification activation

The live predecessor could navigate a suspended or unrelated same-origin window before trying to focus it. It closed the notification at once, had no click handoff, and could not recover an identified chat if the app launched at its manifest start URL. This identifies a failure path, not the specific phone or OS failure.

The candidate leaves the manifest identity, preferences, recipients and message text unchanged. New admin chat notifications carry an in-scope, non-fragment launch address with an opaque notice ID. Where the [Notifications Standard’s navigation option](https://notifications.spec.whatwg.org/) is supported, activating the alert can open that address without a JavaScript click handler. On other browsers the worker requests an app window within the click event before any lookup or disk work. If the browser rejects the request, a short-lived, single-use tap marker allows the next standalone foreground or launch to recover. Only the recipient’s signed-in admin account may resolve the notice, independently of existing per-thread access controls. A normal push delivery never arms recovery.

## Isolated verification

Use a build of this checkout, Node dependencies and Linux Chromium. The database is in-memory, the app provider is stubbed, and the desktop notification service runs only inside an isolated D-Bus session and Xvfb instance.

```sh
npm run check
npm run build
node --import tsx script/test-notifications.ts
QA_PORT=5067 node --import tsx script/test-notifications.ts --serve
# Separate terminal:
MAHA_TEST_INSTALLED=1 CHROME_PATH=/opt/pplx-chromium/chrome \
  dbus-run-session -- xvfb-run -a node script/test-installed-admin-tap.mjs
```

The installed Chromium run checked the actual manifest identity, real service-worker push dispatch, desktop notification activation in warm and closed-app-window scenarios, an exact private DM with editable composer, forced window-opening rejection and recovery, absence of replay after handling, sign-in continuation, and denial for another admin or non-admin. The browser process stayed running for the closed-window case. The native navigation option was not exposed in this Chromium build; the imperative fallback was exercised. None of these tests emulates a physical iPhone or proves what WebKit did on the reported handset.
