import UIKit
import WebKit

/// Hosts the bundled Blueprint Buddy single-file app (www/index.html, copied
/// from dist/ at build time). The page owns its own safe-area handling
/// (viewport-fit=cover + env() insets), so the web view runs edge to edge.
///
/// Native integrations:
///  - window.storage → StoreBridge: designs persist in the app container
///    (backed up by iOS), as the top rung of store.js's driver chain.
///  - blob/data downloads (CSV, SVG, GLB, share files) → WKDownload → the
///    iOS share sheet.
///  - window.print (1:1 paper templates) → AirPrint via
///    UIPrintInteractionController, with the afterprint event dispatched back
///    so ui.js's print cleanup runs.
///  - JS dialogs → native alerts; external links → Safari; a killed WebKit
///    content process (memory pressure on older phones) reloads the app,
///    which restores its own state from the native store.
final class WebViewController: UIViewController {

    // --paper from src/styles.css, light and dark, painted behind the page.
    private static let field = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0x17 / 255.0, green: 0x11 / 255.0, blue: 0x0F / 255.0, alpha: 1)
            : UIColor(red: 0xF1 / 255.0, green: 0xEB / 255.0, blue: 0xDD / 255.0, alpha: 1)
    }

    /// Runs before the app boots (document start, main frame). Installs
    /// window.storage over the StoreBridge message handler — store.js probes
    /// for exactly this API (get → {value}, set, delete) — and reroutes
    /// window.print to the native print bridge. The contract is verified
    /// against the real store.js by test/native-store-bridge.test.js.
    private static let bootstrapJS = """
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
      var print = window.webkit.messageHandlers.bbPrint;
      if (print) window.print = function () { print.postMessage(true); };
    })();
    """

    private var webView: WKWebView!
    private let storeBridge = StoreBridge()
    private var downloadDestinations: [ObjectIdentifier: URL] = [:]

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.field

        let userContent = WKUserContentController()
        userContent.addScriptMessageHandler(storeBridge, contentWorld: .page, name: "bbStore")
        userContent.add(self, name: "bbPrint")
        userContent.addUserScript(WKUserScript(source: Self.bootstrapJS,
                                               injectionTime: .atDocumentStart,
                                               forMainFrameOnly: true))

        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.userContentController = userContent

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

    private func loadApp() {
        guard let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www") else {
            assertionFailure("www/index.html missing — did the Bundle Web App build phase run?")
            return
        }
        webView.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
    }

    private func presentPrint() {
        webView.evaluateJavaScript("window.dispatchEvent(new Event('beforeprint'))", completionHandler: nil)
        let info = UIPrintInfo(dictionary: nil)
        info.jobName = "Blueprint Buddy"
        info.outputType = .general
        let controller = UIPrintInteractionController.shared
        controller.printInfo = info
        controller.printFormatter = webView.viewPrintFormatter()
        controller.present(animated: true) { [weak self] _, _, _ in
            // Fires on completion or cancel either way — ui.js releases the
            // print sheet's DOM on this event.
            self?.webView.evaluateJavaScript("window.dispatchEvent(new Event('afterprint'))", completionHandler: nil)
        }
    }
}

extension WebViewController: WKScriptMessageHandler {

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "bbPrint" { presentPrint() }
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
        if url.isFileURL || url.scheme == "about" {
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
        // Reload; the app restores its state from the native store on boot.
        loadApp()
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
        present(share, animated: true)
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
        if let url = navigationAction.request.url, !url.isFileURL {
            UIApplication.shared.open(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
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
        present(alert, animated: true)
    }
}
