# Blueprint Buddy — iPhone app

A native Swift shell (`WKWebView`) around the same single-file app the web ships:
`dist/index.html` is copied into the bundle at build time by the "Bundle Web App"
build phase, so the iOS app is always exactly the committed build — offline-first,
zero dependencies, nothing fetched at runtime.

## How the shell works

- **`App/WebViewController.swift`** loads `www/index.html` from the bundle
  (`loadFileURL`). The page already handles notch/safe areas itself
  (`viewport-fit=cover` + `env(safe-area-inset-*)` in `styles.css`), so the web
  view runs edge to edge.
- **Exports are native.** The app's downloads (CSV, SVG, SketchUp/COLLADA/GLB,
  share files) are `blob:` anchors; the shell routes them through `WKDownload`
  and presents the iOS share sheet — save to Files, AirDrop, mail, etc.
- **External links** (FAQ references, mailto) open in Safari/Mail, never inside
  the shell. JS `alert`/`confirm`/`prompt` are bridged to native alerts.
- **No server, by design.** With no `/api` origin the client degrades exactly as
  documented in the root `CLAUDE.md`: designs persist to `localStorage`, the
  built-in offline intent parser handles chat, and no sign-in or purchase UI
  appears. That last part matters for App Review: the bundled build contains
  **no purchase flow**, so Apple's in-app-purchase rule (guideline 3.1.1) is not
  in play. If you ever point the shell at the hosted origin instead, the Stripe
  credit-pack flow becomes visible inside the app and **must** be replaced with
  Apple In-App Purchase (or a qualifying external-purchase entitlement) first.

## Build & run (requires a Mac)

1. Prereqs: macOS with Xcode 15+, an [Apple Developer Program](https://developer.apple.com/programs/)
   membership ($99/yr) for App Store distribution.
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
   record with the same bundle identifier.
2. In Xcode: select **Any iOS Device (arm64)** → *Product → Archive* →
   *Distribute App → App Store Connect → Upload*.
3. Fill in the listing. Suggested answers that match what this build actually does:
   - **Privacy nutrition label:** *Data Not Collected* — the bundled app makes
     no network requests, has no accounts, no analytics, no third-party SDKs.
     (Revisit if you later enable the hosted origin.)
   - **Export compliance:** already declared in `Info.plist`
     (`ITSAppUsesNonExemptEncryption = false`); no encryption beyond OS defaults.
   - **Age rating:** the questionnaire yields 4+.
   - **Category:** Utilities or Lifestyle (secondary: Productivity).
   - **App Review notes:** say the app works fully offline with no account —
     parametric furniture design, live structural engineering checks, cut
     lists/BOM, 3D preview, exports via the share sheet. Reviewers reject thin
     website wrappers under guideline 4.2; this is a complete offline
     application with native export integration, and it helps to say so and to
     include a 1–2 line "try: ask for a walnut bookshelf, open Plan → Cut" demo
     script.
4. Submit for review.

## Known iOS limitations

- `window.print()` (the 1:1 paper templates) is a no-op inside `WKWebView`.
  Printing templates at true scale is a desktop-browser workflow; everything
  else (cut list, BOM, exports) works on the phone.
- The service worker (`dist/sw.js`) is not used — irrelevant here, since the
  entire app ships inside the bundle.

## App icon

`App/Assets.xcassets/AppIcon.appiconset/AppIcon1024.png` is generated
procedurally (paper field, drafting grid, espresso table mark, tri-stripe
chrome — the app's own palette). Regenerate with `node ios/icon-gen.js`.
Replace the PNG with real art any time; keep it 1024×1024 RGB **without alpha**.
