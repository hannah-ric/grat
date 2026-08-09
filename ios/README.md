# Blueprint Buddy — iPhone app

A native Swift shell around the same single-file app the web ships. The bundled
`dist/index.html` is copied into the app at build time ("Bundle Web App" phase),
so the iOS app is always exactly the committed build — instant boot, no
first-launch download.

## Two modes — set `BBBackendBaseURL` in `App/Info.plist`

### Account mode (the shipping configuration)

Set `BBBackendBaseURL` to your deployment (see `DEPLOYMENT.md`), e.g.
`https://your-app.vercel.app` (https only). The app is then served from a
custom scheme (`bbapp://local`) whose handler (`App/AppSchemeHandler.swift`)
**natively proxies every same-origin `/api/*` call to your backend**. The page
sees one origin — no CORS, no third-party-cookie blocking — and the session
cookie lives in the native cookie jar, persisting across launches. That gives
the real product:

- **Accounts**: email + password sign-up/sign-in (the repo's first-class
  password accounts — `AUTH_SECRET` + KV is all the backend needs). Sessions
  survive relaunches; sign-out works (the shell runs the logout round-trip
  natively and reboots the app).
- **Designs saved to the account**: the cloud document store, device→cloud
  migration on first sign-in, projects following the user to any device —
  identical to the web because it *is* the web client on the same API.
- **Real AI**: `/api/chat` (your server-held Anthropic key, per-user metering)
  works in-app. Offline moments degrade per call exactly as the web does.
- **Blueprints**: issuing, the free signup credit, re-downloads — and the
  issued sheet set (`window.open('/api/blueprint?…&format=sheets')`) opens in
  an in-app viewer on the same proxied session, with AirPrint.
- **Account deletion in-app**: required by App Store guideline 5.1.1(v) for
  any app with account creation, and implemented for real in this repo —
  `POST /api/auth {action:'delete'}` verifies the password, wipes **every**
  per-account KV root (projects, thumbs, prefs, prices, gallery cache,
  credits/ledger, entitlements usage, issued blueprints + artifacts +
  idempotency hashes, the credential record), and clears the session. A
  coverage guard in `test/server.test.js` greps the client source so a new
  client document can never silently survive deletion. The UI lives on the
  account page (`#signin` → "Delete account…").

Two responses are rewritten by the proxy on `/api/auth?me=1`, keeping the app
App Store-compliant with **zero web or server changes**:

- `billing` is removed → the client never shows the Stripe credit-pack
  purchase flow (guideline 3.1.1 forbids non-IAP digital purchases in-app).
  Credits bought on the web still spend in the app — consumption is allowed,
  Kindle-style. Don't add "buy on our website" links in-app; that's the
  anti-steering line.
- `providers` is emptied → sign-in is email+password only. OAuth round-trips
  can't complete inside a custom-scheme origin, and third-party-only login
  would also trigger the Sign in with Apple requirement (guideline 4.8);
  the service's own email accounts carry no SIWA obligation.

Backend requirements for account mode (all standard `DEPLOYMENT.md` setup):
`AUTH_SECRET` + a KV store (enables accounts + cloud store),
`ANTHROPIC_API_KEY` (enables AI), `APP_ORIGIN` set to your origin.

### Offline mode (default when `BBBackendBaseURL` is empty)

No accounts: the app runs from `file://`, chat uses the built-in offline
parser, and designs persist through `App/NativeBridge.swift` — a native
`window.storage` implementation that store.js adopts as the top rung of its
driver chain, keeping projects in the app container (backed up by iOS, never
evicted). Useful for simulator work and as the no-backend fallback; the
JS↔Swift contract is enforced by `test/store-bridge.test.js` in `npm test`.

## Native integrations (both modes)

- Blob/data downloads (CSV, SVG, SketchUp/COLLADA/GLB, share files) route
  through `WKDownload` into the iOS share sheet, with a success haptic.
- `window.print()` → AirPrint via the web view's print formatter (print CSS
  applies; `afterprint` is dispatched back so ui.js's cleanup runs).
- JS dialogs → native alerts, presented from the top of the presentation
  stack (a covered presentation would strand `confirm()`'s blocked JS).
- External links open in Safari; a killed WebKit content process reloads the
  app; the launch screen and chrome follow light/dark via the app's own
  `--paper` tokens; `NSCameraUsageDescription` covers the photo-input
  chooser's "Take Photo" option (without it iOS kills the app on tap).

## Verification that already ran (no Mac required)

- `test/store-bridge.test.js` (in `npm test`): the offline-mode bootstrap,
  extracted **verbatim** from the Swift source, against the real store.js.
- `test/server.test.js` (in `npm test`): the deletion endpoint — wrong
  password refused, complete wipe, cookie cleared, credentials dead, admin
  refused, client-doc coverage guard.
- End-to-end account-mode rehearsal in Chromium at iPhone size against the
  real dev server, with `me=1` rewritten exactly as the proxy does: register
  → cloud autosave → fresh-boot restore → refused wrong-password delete →
  complete wipe → dead credentials. What remains genuinely unverifiable off-Mac
  is the Swift compile and the native transport itself.

## Build & run (requires a Mac)

1. macOS with current Xcode (App Store submissions must use Apple's
   current-SDK Xcode; the project opens in Xcode 15+), Apple Developer
   Program membership for distribution.
2. `open ios/BlueprintBuddy.xcodeproj`
3. Target **BlueprintBuddy** → *Signing & Capabilities*: set your **Team**,
   change the bundle id from the `com.example.blueprintbuddy` placeholder.
4. Set `BBBackendBaseURL` in `App/Info.plist` to your deployment.
5. Run. To refresh the bundled web app: `npm run build` at the repo root,
   build again in Xcode.

## Ship to the App Store

1. Create the app record in App Store Connect (check name availability).
2. **Any iOS Device (arm64)** → *Product → Archive* → *Distribute App →
   App Store Connect → Upload*.
3. Screenshots: run in the largest iPhone simulator, **Cmd+S** — simulator
   screenshots are the exact accepted sizes. Good sequence: porch masthead →
   a design in the studio → Plan › Cut list → sign-in page.
4. Listing answers that match what account mode actually does:
   - **Privacy nutrition label**: account mode collects *Contact Info (email
     address)* and *User Content (designs, chat)*, linked to identity, for
     app functionality only — no tracking, no third-party SDKs, no ads.
     (Offline mode would be *Data Not Collected*.)
   - **Export compliance**: declared in `Info.plist`
     (`ITSAppUsesNonExemptEncryption = false`) — standard HTTPS only.
   - **Sign-in for review**: provide a working demo account (create one in
     the app) in App Review notes.
   - **Age rating**: 4+. **Category**: Utilities or Lifestyle.
   - **Review notes**: full parametric furniture design with live structural
     engineering, accounts with cloud-synced projects, in-app account
     deletion on the account page, AirPrint templates, native share-sheet
     exports. Include a 2-line demo script ("create an account, ask for a
     walnut bookshelf, open Plan → Cut, print a template").
5. Submit.

## App icon

`App/Assets.xcassets/AppIcon.appiconset/AppIcon1024.png` is generated
procedurally from the app's own palette — regenerate with
`node ios/icon-gen.js`. Keep any replacement 1024×1024 RGB **without alpha**.
