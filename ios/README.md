# Blueprint Buddy — iPhone app

A native Swift shell (`WKWebView`) around the same single-file app the web ships:
`dist/index.html` is copied into the bundle at build time by the "Bundle Web App"
build phase, so the iOS app is always exactly the committed build — offline-first,
zero dependencies, nothing fetched at runtime.

## Native integrations (what makes this an app, not a wrapper)

- **Designs persist natively.** The shell injects a `window.storage`
  implementation backed by files in the app container
  (`App/NativeBridge.swift`), which `store.js` adopts as the **top rung** of
  its driver chain — above localStorage, exactly like artifact hosting on the
  web. Projects survive app updates, phone restores, and low-disk pressure
  (WKWebView's file-origin localStorage can be evicted; the app container
  cannot), and they ride device backups to a new phone. The JS↔Swift contract
  is enforced by `test/store-bridge.test.js` (part of `npm test`), which runs
  the bootstrap script extracted **verbatim** from the Swift source against the
  real `store.js`.
- **1:1 paper templates print.** `window.print()` is rerouted to AirPrint
  (`UIPrintInteractionController` over the web view's print formatter, which
  applies the app's `@media print` stylesheet), and the `afterprint` event is
  dispatched back so ui.js's print cleanup runs. As on any printer, check a
  printed dimension with a ruler before cutting.
- **Exports are native.** The app's downloads (CSV, SVG, SketchUp/COLLADA/GLB,
  share files) are `blob:` anchors; the shell routes them through `WKDownload`
  and presents the iOS share sheet — save to Files, AirDrop, mail — with a
  success haptic.
- **Crash recovery.** If iOS kills the WebKit content process (memory pressure
  during heavy 3D on older phones), the shell reloads the app, which restores
  its state from the native store.
- **External links** open in Safari/Mail, never inside the shell; JS
  `alert`/`confirm`/`prompt` are bridged to native alerts; the launch screen
  and shell chrome follow light/dark mode using the app's own `--paper` tokens.
- **Permissions:** the only usage strings are camera (WKWebView's file chooser
  offers "Take Photo" for the design-from-photo flow — without the string, iOS
  kills the app the moment a user taps it) and photo-library-add (share sheet
  "Save Image"). Nothing is accessed until the user explicitly chooses those
  paths.

## No server, by design

With no `/api` origin the client degrades exactly as documented in the root
`CLAUDE.md`: the built-in offline intent parser handles chat, and no sign-in or
purchase UI appears. That matters for App Review: the bundled build contains
**no purchase flow**, so Apple's in-app-purchase rule (guideline 3.1.1) is not
in play. If you ever point the shell at the hosted origin instead, the Stripe
credit-pack flow becomes visible inside the app and **must** be replaced with
Apple In-App Purchase (or a qualifying external-purchase entitlement) first.

## Build & run (requires a Mac)

1. Prereqs: macOS with a current Xcode (App Store submissions must use Apple's
   current-SDK Xcode; the project itself opens in Xcode 15+), and an
   [Apple Developer Program](https://developer.apple.com/programs/) membership
   ($99/yr) for App Store distribution.
2. `open ios/BlueprintBuddy.xcodeproj`
3. Select the **BlueprintBuddy** target → *Signing & Capabilities*:
   - set **Team** to your team;
   - change the **bundle identifier** from the `com.example.blueprintbuddy`
     placeholder to one you own (e.g. `com.yourdomain.blueprintbuddy`).
4. Pick an iPhone simulator or device and Run. To refresh the web app inside it,
   run `npm run build` at the repo root and build again — the copy happens every
   Xcode build.

## Ship to the App Store

1. In [App Store Connect](https://appstoreconnect.apple.com), create the app
   record with the same bundle identifier (check the app name is free —
   "Blueprint Buddy" may need a suffix).
2. In Xcode: select **Any iOS Device (arm64)** → *Product → Archive* →
   *Distribute App → App Store Connect → Upload*.
3. Screenshots: run the app in the largest current iPhone simulator and press
   **Cmd+S** — simulator screenshots are already the exact pixel sizes App
   Store Connect accepts. Good sequence: porch masthead → a design in the 3D
   studio → Plan › Cut list → a dimensioned drawing.
4. Fill in the listing. Suggested answers that match what this build actually does:
   - **Privacy nutrition label:** *Data Not Collected* — the bundled app makes
     no network requests, has no accounts, no analytics, no third-party SDKs.
     (Revisit if you later enable the hosted origin.)
   - **Export compliance:** already declared in `Info.plist`
     (`ITSAppUsesNonExemptEncryption = false`).
   - **Age rating:** the questionnaire yields 4+.
   - **Category:** Utilities or Lifestyle (secondary: Productivity).
   - **App Review notes:** say the app works fully offline with no account —
     parametric furniture design, live structural engineering checks, cut
     lists/BOM, 3D preview, AirPrint templates, exports via the share sheet.
     Reviewers reject thin website wrappers under guideline 4.2; this is a
     complete offline application with native persistence, printing, and
     export integration — say so, and include a 1–2 line demo script
     ("ask for a walnut bookshelf, open Plan → Cut, print a template").
5. Submit for review.

## App icon

`App/Assets.xcassets/AppIcon.appiconset/AppIcon1024.png` is generated
procedurally (paper field, drafting grid, espresso table mark, tri-stripe
chrome — the app's own palette). Regenerate with `node ios/icon-gen.js`.
Replace the PNG with real art any time; keep it 1024×1024 RGB **without alpha**.
