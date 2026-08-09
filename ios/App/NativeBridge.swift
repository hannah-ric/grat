import Foundation
import WebKit

/// Backs the web app's `window.storage` — the TOP rung of store.js's driver
/// chain (artifact → cloud → device → memory) — with plain files in the app's
/// Application Support directory. Unlike WKWebView's file-origin localStorage,
/// which iOS may evict under disk pressure, the app container is permanent and
/// included in device backups, so designs survive updates, restores, and new
/// phones. Values arrive already JSON-stringified (store.js owns encoding);
/// this class only moves opaque strings.
///
/// Contract with the injected bootstrap script (WebViewController):
///   {op:"get", key}        → file contents as String, or null when absent
///   {op:"set", key, value} → true
///   {op:"del", key}        → true
/// Errors reject the promise; store.js catches per call and falls through to
/// its next rung, so a broken bridge degrades instead of breaking the app.
final class StoreBridge: NSObject, WKScriptMessageHandlerWithReply {

    private let queue = DispatchQueue(label: "com.blueprintbuddy.store")
    private let directory: URL

    override init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        directory = support.appendingPathComponent("BlueprintBuddyStore", isDirectory: true)
        super.init()
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    /// Keys like "project:169..." become percent-encoded filenames; the
    /// encoding is injective, so distinct keys never collide.
    private func fileURL(forKey key: String) -> URL {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._")
        let name = key.addingPercentEncoding(withAllowedCharacters: allowed) ?? key
        return directory.appendingPathComponent(name + ".json", isDirectory: false)
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any],
              let op = body["op"] as? String,
              let key = body["key"] as? String else {
            replyHandler(nil, "malformed store message")
            return
        }
        let value = body["value"] as? String
        let file = fileURL(forKey: key)
        queue.async {
            var result: Any?
            var failure: String?
            switch op {
            case "get":
                result = (try? String(contentsOf: file, encoding: .utf8)) ?? NSNull()
            case "set":
                if let value = value {
                    do {
                        try value.write(to: file, atomically: true, encoding: .utf8)
                        result = true
                    } catch {
                        failure = "write failed: \(error.localizedDescription)"
                    }
                } else {
                    failure = "set without value"
                }
            case "del":
                try? FileManager.default.removeItem(at: file)
                result = true
            default:
                failure = "unknown op: \(op)"
            }
            DispatchQueue.main.async { replyHandler(result, failure) }
        }
    }
}
