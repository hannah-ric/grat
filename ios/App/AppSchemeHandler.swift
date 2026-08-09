import Foundation
import WebKit

/// Account mode's transport. Serves the bundled single-file app from a custom
/// scheme (bbapp://local) and natively proxies its same-origin /api/* calls to
/// the configured backend. The page sees ONE origin, so there is no CORS and
/// no third-party-cookie blocking; the backend session cookie lives in the
/// native cookie jar (HTTPCookieStorage.shared), persists across launches, and
/// never crosses into page JavaScript. Sign-in, cloud projects, credits, and
/// the real AI proxy all work exactly as on the web.
///
/// One response rewrite keeps the app App Store-compliant with zero web or
/// server changes, applied to /api/auth?me=1:
///  - `billing` is removed, so the client never shows the Stripe credit-pack
///    purchase flow (guideline 3.1.1 forbids non-IAP digital purchases in
///    app; credits bought on the web still spend here — consumption is fine).
///  - `providers` is emptied, so sign-in is the email+password form: OAuth
///    round-trips would leave the custom-scheme origin, and third-party-only
///    login would additionally trigger the Sign in with Apple rule (4.8).
///    Email+password accounts are the service's own — no SIWA obligation.
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {

    static let scheme = "bbapp"
    static let appURL = URL(string: "bbapp://local/index.html")!

    private let backend: URL
    private let session: URLSession
    private var upstreamTasks: [ObjectIdentifier: URLSessionDataTask] = [:] // main thread only

    init(backend: URL) {
        self.backend = backend
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = HTTPCookieStorage.shared
        config.httpCookieAcceptPolicy = .always
        self.session = URLSession(configuration: config)
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else { return }
        if url.path.hasPrefix("/api") {
            proxy(urlSchemeTask, url: url)
        } else {
            serveApp(urlSchemeTask, url: url)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        upstreamTasks.removeValue(forKey: ObjectIdentifier(urlSchemeTask))?.cancel()
    }

    // MARK: - the bundled app

    private func serveApp(_ task: WKURLSchemeTask, url: URL) {
        guard url.path == "/" || url.path == "/index.html",
              let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www"),
              let data = try? Data(contentsOf: index) else {
            finish(task, status: 404, headers: ["Content-Type": "text/plain"], data: Data("not found".utf8), url: url)
            return
        }
        finish(task, status: 200,
               headers: ["Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"],
               data: data, url: url)
    }

    // MARK: - the /api proxy

    private func proxy(_ task: WKURLSchemeTask, url: URL) {
        guard var comps = URLComponents(url: backend, resolvingAgainstBaseURL: false) else { return }
        comps.path = url.path
        comps.percentEncodedQuery = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedQuery
        guard let target = comps.url else {
            finish(task, status: 502, headers: ["Content-Type": "text/plain"], data: Data("bad backend url".utf8), url: url)
            return
        }

        var request = URLRequest(url: target)
        request.httpMethod = task.request.httpMethod
        request.httpBody = task.request.httpBody ?? task.request.httpBodyStream.map(readAll)
        for (name, value) in task.request.allHTTPHeaderFields ?? [:] {
            // These describe the bbapp origin or the transport; the proxy owns them.
            if ["host", "origin", "referer", "content-length", "cookie"].contains(name.lowercased()) { continue }
            request.setValue(value, forHTTPHeaderField: name)
        }
        // Same-origin checks upstream should see the backend's own origin.
        if request.httpMethod != "GET" {
            request.setValue(backendOrigin, forHTTPHeaderField: "Origin")
        }
        request.setValue("ios", forHTTPHeaderField: "X-BB-Client")

        let id = ObjectIdentifier(task)
        let isAuthProbe = url.path == "/api/auth" && (url.query ?? "").contains("me=")
        let upstream = session.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                // A missing entry means WebKit stopped this task — touching it now traps.
                guard let self = self, self.upstreamTasks.removeValue(forKey: id) != nil else { return }
                if let error = error {
                    task.didFailWithError(error)
                    return
                }
                guard let http = response as? HTTPURLResponse else {
                    task.didFailWithError(URLError(.badServerResponse))
                    return
                }
                var body = data ?? Data()
                if isAuthProbe { body = Self.stripUnsupportedOnIOS(from: body) }
                var headers: [String: String] = [:]
                for (k, v) in http.allHeaderFields {
                    guard let name = k as? String, let value = v as? String else { continue }
                    // URLSession already decoded the body and jarred the cookies —
                    // forwarding these headers would corrupt both.
                    if ["set-cookie", "content-encoding", "content-length", "transfer-encoding",
                        "connection", "keep-alive"].contains(name.lowercased()) { continue }
                    headers[name] = value
                }
                headers["Content-Length"] = String(body.count)
                self.finish(task, status: http.statusCode, headers: headers, data: body, url: url)
            }
        }
        upstreamTasks[id] = upstream
        upstream.resume()
    }

    private var backendOrigin: String {
        var comps = URLComponents(url: backend, resolvingAgainstBaseURL: false)!
        comps.path = ""
        comps.query = nil
        return comps.string ?? backend.absoluteString
    }

    private func finish(_ task: WKURLSchemeTask, status: Int, headers: [String: String], data: Data, url: URL) {
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else { return }
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    private func readAll(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        while stream.hasBytesAvailable {
            let n = stream.read(&buffer, maxLength: buffer.count)
            if n <= 0 { break }
            data.append(buffer, count: n)
        }
        return data
    }

    /// /api/auth?me=1 → remove `billing` (no purchase UI: 3.1.1) and empty
    /// `providers` (email+password sign-in only). Anything unparseable passes
    /// through untouched — the client then treats it as it would on the web.
    static func stripUnsupportedOnIOS(from body: Data) -> Data {
        guard var json = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] else { return body }
        json.removeValue(forKey: "billing")
        json["providers"] = [String]()
        return (try? JSONSerialization.data(withJSONObject: json)) ?? body
    }
}
