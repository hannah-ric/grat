import UIKit
import WebKit

/// Hosts the bundled Blueprint Buddy single-file app (www/index.html, copied
/// from dist/ at build time). The page owns its own safe-area handling
/// (viewport-fit=cover + env() insets), so the web view runs edge to edge.
///
/// Two modes, chosen by Info.plist → BBBackendBaseURL:
///  - ACCOUNT MODE (URL set): the app is served from the bbapp:// custom
///    scheme and its /api/* calls are natively proxied to the backend
///    (AppSchemeHandler) — real sign-in, cloud projects that follow the
///    account, credits, and the server-side AI. store.js's own chain handles
///    offline moments (device write-through), exactly as on the web.
///  - OFFLINE MODE (URL empty): file:// + StoreBridge — no accounts, designs
///    persist natively on-device, chat uses the built-in offline parser.
///
/// Shared native integrations: blob/data downloads → WKDownload → share
/// sheet; window.print → AirPrint; JS dialogs → native alerts (presented from
/// the top of the stack so a blocked confirm() can never strand page JS);
/// window.open popups (the issued blueprint sheet set) → an in-app modal
/// viewer on the same proxied session; a killed WebKit content process
/// reloads the app, which restores its state from storage.
final class WebViewController: UIViewController {

    // --paper from src/styles.css, light and dark, painted behind the page.
    private static let field = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0x17 / 255.0, green: 0x11 / 255.0, blue: 0x0F / 255.0, alpha: 1)
            : UIColor(red: 0xF1 / 255.0, green: 0xEB / 255.0, blue: 0xDD / 255.0, alpha: 1)
    }

    /// Backend origin for account mode. Set BBBackendBaseURL in Info.plist to
    /// your deployment (DEPLOYMENT.md), e.g. https://your-app.vercel.app —
    /// https only. Empty → offline mode.
    private static var backendURL: URL? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "BBBackendBaseURL") as? String else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let url = URL(string: trimmed), url.scheme == "https", url.host != nil else { return nil }
        return url
    }

    /// OFFLINE MODE ONLY — installs window.storage over the StoreBridge
    /// message handler; store.js probes for exactly this API (get → {value},
    /// set, delete) and adopts it as the top rung of its driver chain. The
    /// contract is verified against the real store.js by
    /// test/store-bridge.test.js, which extracts this literal verbatim.
    private static let storageBootstrapJS = """
    (function () {
      if (!window.webkit || !window.webkit.messageHandlers) return;
      var store = window.webkit.messageHandlers.bbStore;
      if (store && !window.storage) {
        window.storage = {
          get: function (key) { return store.postMessage({ op: 'get', key: String(key) }).then(function (v) { return { value: v === undefined ? null : v }; }); },
          set: function (key, value) { return store.postMessage({ op: 'set', key: String(key), value: String(value) }); },
          delete: function (key) { return store.postMessage({ op: 'del', key: String(key) }); }
        };
      }
    })();
    """

    /// BOTH MODES — reroutes window.print to AirPrint. Also extracted
    /// verbatim by test/store-bridge.test.js.
    private static let printBootstrapJS = """
    (function () {
      if (!window.webkit || !window.webkit.messageHandlers) return;
      var print = window.webkit.messageHandlers.bbPrint;
      if (print) window.print = function () { print.postMessage(true); };
    })();
    """

    private var webView: WKWebView!
    private let storeBridge = StoreBridge()
    private var schemeHandler: AppSchemeHandler?
    private var downloadDestinations: [ObjectIdentifier: URL] = [:]

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.field

        let backend = Self.backendURL
        let userContent = WKUserContentController()
        if backend == nil {
            userContent.addScriptMessageHandler(storeBridge, contentWorld: .page, name: "bbStore")
            userContent.addUserScript(WKUserScript(source: Self.storageBootstrapJS,
                                                   injectionTime: .atDocumentStart,
                                                   forMainFrameOnly: true))
        }
        userContent.add(self, name: "bbPrint")
        userContent.addUserScript(WKUserScript(source: Self.printBootstrapJS,
                                               injectionTime: .atDocumentStart,
                                               forMainFrameOnly: true))

        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.userContentController = userContent
        if let backend = backend {
            let handler = AppSchemeHandler(backend: backend)
            configuration.setURLSchemeHandler(handler, forURLScheme: AppSchemeHandler.scheme)
            schemeHandler = handler
        }

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = Self.field
        webView.scrollView.backgroundColor = Self.field
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive
        webView.allowsBackForwardNavigationGestures = false
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        loadApp()
    }

    /// Dialogs and share sheets must present from the TOP of the presentation
    /// stack: presenting from a covered controller fails silently, and for
    /// confirm()/prompt() a failed presentation would strand the page's
    /// blocked JavaScript forever (WebKit waits on the completion handler).
    private var topPresenter: UIViewController {
        var top: UIViewController = self
        while let presented = top.presentedViewController { top = presented }
        return top
    }

    private func loadApp() {
        guard Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www") != nil else {
            assertionFailure("www/index.html missing — did the Bundle Web App build phase run?")
            showBundleError()
            return
        }
        if schemeHandler != nil {
            webView.load(URLRequest(url: AppSchemeHandler.appURL))
        } else {
            let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www")!
            webView.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
        }
    }

    /// Release-build fallback for a broken bundle: a blank screen would be
    /// undiagnosable; say what happened and how to fix it.
    private func showBundleError() {
        let label = UILabel()
        label.text = "This build is incomplete — www/index.html is missing from the app bundle.\n\nRebuild in Xcode: the “Bundle Web App” phase copies dist/index.html from the repository."
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = .label
        label.font = .preferredFont(forTextStyle: .callout)
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor),
            label.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 32),
            label.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -32),
        ])
    }

    /// Whether a URL belongs to the app itself (either mode's origin).
    private func isAppURL(_ url: URL?) -> Bool {
        guard let url = url else { return true } // e.g. a not-yet-loaded popup
        return url.isFileURL || url.scheme == AppSchemeHandler.scheme || url.scheme == "about"
    }

    /// Sign-out is a main-frame navigation to /api/auth?logout=1. Run it
    /// natively (the shared cookie jar picks up the cleared cookie) and
    /// reboot the app rather than rendering an API response as the page.
    private func visitNativelyThenReload(_ url: URL) {
        guard let backend = Self.backendURL,
              var comps = URLComponents(url: backend, resolvingAgainstBaseURL: false) else {
            loadApp()
            return
        }
        comps.path = url.path
        comps.percentEncodedQuery = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedQuery
        guard let target = comps.url else {
            loadApp()
            return
        }
        URLSession.shared.dataTask(with: target) { [weak self] _, _, _ in
            DispatchQueue.main.async { self?.loadApp() }
        }.resume()
    }

    private func presentPrint(from target: WKWebView) {
        target.evaluateJavaScript("window.dispatchEvent(new Event('beforeprint'))", completionHandler: nil)
        let info = UIPrintInfo(dictionary: nil)
        info.jobName = "Blueprint Buddy"
        info.outputType = .general
        let controller = UIPrintInteractionController.shared
        controller.printInfo = info
        controller.printFormatter = target.viewPrintFormatter()
        controller.present(animated: true) { _, _, _ in
            // Fires on completion or cancel either way — ui.js releases the
            // print sheet's DOM on this event.
            target.evaluateJavaScript("window.dispatchEvent(new Event('afterprint'))", completionHandler: nil)
        }
    }

    /// In-app popups — the issued blueprint sheet set opens via
    /// window.open('/api/blueprint?…&format=sheets'). WebKit requires the
    /// child to use the provided configuration (it shares the scheme handler,
    /// so the proxied session and cookies apply) and loads the request into
    /// the returned web view itself.
    fileprivate func presentPopup(_ child: WKWebView) {
        let host = UIViewController()
        host.view.backgroundColor = Self.field
        child.isOpaque = false
        child.backgroundColor = Self.field
        child.translatesAutoresizingMaskIntoConstraints = false
        host.view.addSubview(child)
        NSLayoutConstraint.activate([
            child.topAnchor.constraint(equalTo: host.view.topAnchor),
            child.bottomAnchor.constraint(equalTo: host.view.bottomAnchor),
            child.leadingAnchor.constraint(equalTo: host.view.leadingAnchor),
            child.trailingAnchor.constraint(equalTo: host.view.trailingAnchor),
        ])
        host.navigationItem.title = "Blueprint"
        host.navigationItem.rightBarButtonItem = UIBarButtonItem(
            systemItem: .done,
            primaryAction: UIAction { [weak host] _ in host?.dismiss(animated: true) })
        let nav = UINavigationController(rootViewController: host)
        topPresenter.present(nav, animated: true)
    }
}

extension WebViewController: WKScriptMessageHandler {

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "bbPrint" { presentPrint(from: message.webView ?? webView) }
    }
}

extension WebViewController: WKNavigationDelegate {

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if isAppURL(url) {
            if url.scheme == AppSchemeHandler.scheme, url.path == "/api/auth",
               navigationAction.targetFrame?.isMainFrame == true, webView === self.webView {
                decisionHandler(.cancel)
                visitNativelyThenReload(url)
                return
            }
            decisionHandler(.allow)
        } else if url.scheme == "blob" || url.scheme == "data" {
            decisionHandler(.download)
        } else {
            decisionHandler(.cancel)
            UIApplication.shared.open(url)
        }
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // WebKit killed the page (usually memory pressure during heavy 3D).
        // Reload; the app restores its state from storage on boot.
        if webView === self.webView { loadApp() }
    }
}

extension WebViewController: WKDownloadDelegate {

    func download(_ download: WKDownload,
                  decideDestinationUsing response: URLResponse,
                  suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            completionHandler(nil)
            return
        }
        let destination = directory.appendingPathComponent(suggestedFilename)
        downloadDestinations[ObjectIdentifier(download)] = destination
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let url = downloadDestinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        share.popoverPresentationController?.sourceView = view
        share.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
        topPresenter.present(share, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadDestinations.removeValue(forKey: ObjectIdentifier(download))
    }
}

extension WebViewController: WKUIDelegate {

    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard isAppURL(navigationAction.request.url) else {
            if let url = navigationAction.request.url { UIApplication.shared.open(url) }
            return nil
        }
        let child = WKWebView(frame: .zero, configuration: configuration)
        child.navigationDelegate = self
        child.uiDelegate = self
        #if DEBUG
        if #available(iOS 16.4, *) { child.isInspectable = true }
        #endif
        presentPopup(child)
        return child
    }

    func webViewDidClose(_ webView: WKWebView) {
        guard webView !== self.webView else { return }
        var responder: UIResponder? = webView
        while let current = responder {
            if let controller = current as? UIViewController {
                controller.dismiss(animated: true)
                return
            }
            responder = current.next
        }
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        topPresenter.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        topPresenter.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in
            completionHandler(alert?.textFields?.first?.text)
        })
        topPresenter.present(alert, animated: true)
    }
}
