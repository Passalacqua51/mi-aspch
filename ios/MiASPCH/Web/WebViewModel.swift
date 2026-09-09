import Foundation
import Combine
import WebKit
import OSLog

enum WebState: String {
    case starting = "STARTING"
    case webViewCreated = "WEBVIEW_CREATED"
    case loading = "LOADING"
    case finished = "FINISHED"
    case failed = "FAILED"
}

@MainActor
final class WebViewModel: ObservableObject {
    @Published var isLoading = false
    @Published var connectionError: String?
    @Published var lastURL: URL?
    @Published var webState: WebState = .starting
    @Published var lastErrorMessage: String?
    @Published var sessionState: WebSessionState = .unknown
    #if DEBUG
    @Published var connectivityStatus: String?
    #endif

    @Published private(set) var navigation = WebNavigationSnapshot()

    // Strong ownership belongs to the root StateObject, never to an individual tab.
    private(set) var webView: WKWebView?
    private var hasLoadedInitial = false
    private var pendingRequest: URLRequest?

    func hasSessionCookie() async -> Bool {
        let store = WKWebsiteDataStore.default().httpCookieStore
        let cookies = await store.allCookies()
        let found = cookies.contains { cookie in
            (cookie.name == "mi_aspch_session" || cookie.name == "mi_aspch_preview_session")
            && !cookie.value.isEmpty
            && (cookie.expiresDate == nil || cookie.expiresDate! > Date())
        }
        authDebugLog("cookie/session observed: \(found ? "present" : "absent")")
        return found
    }

    func persistentWebView(environment: AppEnvironment) -> WKWebView {
        if let webView {
            authDebugLog("WKWebView reused")
            return webView
        }
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.websiteDataStore = .default()
        configuration.userContentController.addUserScript(WKUserScript(
            source: WebNavigationBridge.source(environment: environment),
            injectionTime: .atDocumentEnd, forMainFrameOnly: true,
            in: .page
        ))
        #if DEBUG
        configuration.userContentController.addUserScript(WKUserScript(
            source: AuthDebugBridge.source,
            injectionTime: .atDocumentStart, forMainFrameOnly: true,
            in: .page
        ))
        #endif
        let view = WKWebView(frame: .zero, configuration: configuration)
        webView = view
        appLogger.info("WKWebView created (persistent)")
        authDebugLog("WKWebView created")
        return view
    }

    func loadPendingIfNeeded() {
        guard let webView, let request = pendingRequest else { return }
        pendingRequest = nil
        webView.load(request)
    }

    func receiveNavigation(_ snapshot: WebNavigationSnapshot) {
        if navigation != snapshot {
            navigation = snapshot
        }
        if sessionState != snapshot.sessionState {
            authDebugLog("native auth state changed: \(sessionState.rawValue) -> \(snapshot.sessionState.rawValue)")
            sessionState = snapshot.sessionState
        }
    }

    func unlockWithPIN(_ pin: String) async -> String? {
        guard let webView else { return "Web view no disponible." }
        do {
            let result: Any? = try await webView.callAsyncJavaScript(
                """
                try {
                    const response = await fetch('/api/security/unlock', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'same-origin',
                        body: JSON.stringify({ pin: String(pin || '') })
                    });
                    const data = await response.json().catch(() => ({}));
                    if (!response.ok) {
                        return { success: false, error: data.error || 'PIN incorrecto.' };
                    }
                    if (typeof state !== 'undefined') {
                        state.security = data.security || state.security;
                    }
                    sessionStorage.setItem('miAspchUnlocked', '1');
                    if (typeof loginSuccess === 'function') {
                        loginSuccess();
                    }
                    return { success: true };
                } catch (error) {
                    return { success: false, error: error.message || 'Error de conexión.' };
                }
                """,
                arguments: ["pin": pin],
                in: nil,
                contentWorld: .page
            )
            if let dict = result as? [String: Any],
               let success = dict["success"] as? Bool {
                if success {
                    sessionState = .authenticated
                    return nil
                } else {
                    return dict["error"] as? String ?? "PIN incorrecto."
                }
            }
            return "No fue posible validar el PIN."
        } catch {
            return error.localizedDescription
        }
    }

    func completeLocalUnlock() async -> String? {
        guard let webView else { return "Web view no disponible." }
        do {
            let result: Any? = try await webView.callAsyncJavaScript(
                """
                try {
                    sessionStorage.setItem('miAspchUnlocked', '1');
                    if (typeof loginSuccess === 'function' && typeof state !== 'undefined' && state.member) {
                        loginSuccess();
                    }
                    return { success: true };
                } catch (error) {
                    return { success: false, error: error.message || 'No fue posible abrir Mi ASPCH.' };
                }
                """,
                in: nil,
                contentWorld: .page
            )
            if let dict = result as? [String: Any],
               let success = dict["success"] as? Bool {
                if success {
                    sessionState = .authenticated
                    return nil
                }
                return dict["error"] as? String ?? "No fue posible abrir Mi ASPCH."
            }
            return "No fue posible abrir Mi ASPCH."
        } catch {
            return error.localizedDescription
        }
    }

    func logout() {
        guard let webView else { return }
        sessionState = .unauthenticated
        webView.callAsyncJavaScript("window.miASPCHNavigation?.logout()", in: nil, in: .page) { _ in }
    }

    func activate(_ item: WebNavigationItem) {
        guard navigation.primary.contains(item) || navigation.secondary.contains(item),
              let webView else { return }
        let id = item.id
        webView.callAsyncJavaScript("return window.miASPCHNavigation?.activate(id) ?? false",
                                   arguments: ["id": id], in: nil,
                                   in: .page) { [weak webView] result in
            if case .success(let handled) = result, (handled as? Bool) == true {
                return
            }
            webView?.callAsyncJavaScript("""
                if (typeof window.go === 'function') {
                    window.go(id);
                    return true;
                }
                const b = document.querySelector('#mobile-nav [data-view="' + id + '"], [data-view="' + id + '"], [data-account-view="' + id + '"], [data-go="' + id + '"]');
                if (b && !b.disabled) { b.click(); return true; }
                return false;
            """, arguments: ["id": id], in: nil, in: .page) { _ in }
        }
    }

    func navigate(to id: String) {
        guard let webView else { return }
        webView.callAsyncJavaScript("return window.miASPCHNavigation?.activate(id) ?? false",
                                   arguments: ["id": id], in: nil,
                                   in: .page) { [weak webView] result in
            if case .success(let handled) = result, (handled as? Bool) == true {
                return
            }
            webView?.callAsyncJavaScript("""
                if (typeof window.go === 'function') {
                    window.go(id);
                    return true;
                }
                const b = document.querySelector('#mobile-nav [data-view="' + id + '"], [data-view="' + id + '"], [data-account-view="' + id + '"], [data-go="' + id + '"]');
                if (b && !b.disabled) { b.click(); return true; }
                return false;
            """, arguments: ["id": id], in: nil, in: .page) { _ in }
        }
    }

    func loadInitialIfNeeded(url: URL) {
        guard !hasLoadedInitial else { return }
        hasLoadedInitial = true
        webState = .webViewCreated
        let request = pendingRequest ?? URLRequest(url: url)
        pendingRequest = nil
        load(request)
    }

    func reload() {
        connectionError = nil
        webView?.reload()
    }

    func load(_ request: URLRequest) {
        appLogger.info("load() called with URL: \(request.url?.absoluteString ?? "<nil>", privacy: .public)")
        print("[MiASPCH] Initial URL: \(request.url?.absoluteString ?? "<nil>")")
        if let ats = Bundle.main.object(forInfoDictionaryKey: "NSAppTransportSecurity") as? [String: Any] {
            print("[MiASPCH] ATS: \(ats)")
        } else {
            print("[MiASPCH] ATS: <none>")
        }
        lastURL = request.url
        connectionError = nil
        #if DEBUG
        if let url = request.url {
            checkConnectivity(url: url)
        }
        #endif
        if let webView = self.webView {
            webView.load(request)
        } else {
            pendingRequest = request
        }
    }

    #if DEBUG
    func checkConnectivity(url: URL) {
        Task {
            do {
                var request = URLRequest(url: url)
                request.timeoutInterval = 10
                let (_, response) = try await URLSession.shared.data(for: request)
                if let httpResponse = response as? HTTPURLResponse {
                    let status = httpResponse.statusCode
                    appLogger.info("URLSession connectivity check HTTP status: \(status)")
                    self.connectivityStatus = "HTTP \(status)"
                } else {
                    appLogger.info("URLSession connectivity check: Non-HTTP response")
                    self.connectivityStatus = "Non-HTTP response"
                }
            } catch {
                let nsError = error as NSError
                appLogger.error("URLSession connectivity check failed: \(error.localizedDescription, privacy: .public), code: \(nsError.code)")
                self.connectivityStatus = "Error: \(error.localizedDescription) (\(nsError.code))"
            }
        }
    }
    #endif
}
