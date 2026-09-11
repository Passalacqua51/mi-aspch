import SwiftUI
import WebKit
import OSLog
import PhotosUI
import UniformTypeIdentifiers
import UIKit

struct MiASPCHWebView: UIViewRepresentable {
    let environment: AppEnvironment
    @ObservedObject var model: WebViewModel
    @Environment(\.colorScheme) private var colorScheme

    func makeUIView(context: Context) -> WKWebView {
        let webView = model.persistentWebView(environment: environment)
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: WebNavigationBridge.handlerName, contentWorld: .page)
        webView.configuration.userContentController.add(
            WeakNavigationHandler(context.coordinator), contentWorld: .page,
            name: WebNavigationBridge.handlerName)
        #if DEBUG
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: AuthDebugBridge.handlerName, contentWorld: .page)
        webView.configuration.userContentController.add(
            WeakNavigationHandler(context.coordinator), contentWorld: .page,
            name: AuthDebugBridge.handlerName)
        #endif
        applyAppearance(to: webView)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.refreshControl = context.coordinator.refreshControl
        context.coordinator.webView = webView
        Task { @MainActor in model.loadPendingIfNeeded() }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        applyAppearance(to: webView)
    }

    private func applyAppearance(to webView: WKWebView) {
        // SwiftUI's current appearance is the source of truth, including changes
        // while this persistent web view is already displaying a document.
        let style: UIUserInterfaceStyle = colorScheme == .dark ? .dark : .light
        if webView.overrideUserInterfaceStyle != style {
            webView.overrideUserInterfaceStyle = style
        }
        webView.isOpaque = false
        Self.applyInformaticaBackground(to: webView)
        #if DEBUG
        AppearanceDiagnostics.capture(colorScheme: colorScheme, webView: webView)
        #endif
    }

    /// OLED dark canvas for the Informática panel (/informatica) and the system
    /// background everywhere else. Keeps the persistent WKWebView's own surfaces
    /// black while the panel is open, so safe-area/overscroll edges never flash
    /// white. Purely visual: no navigation, session or auth behavior changes.
    static func applyInformaticaBackground(to webView: WKWebView) {
        let background: UIColor = isInformaticaPanel(webView.url) ? .black : .systemBackground
        webView.backgroundColor = background
        webView.scrollView.backgroundColor = background
        webView.underPageBackgroundColor = background
    }

    static func isInformaticaPanel(_ url: URL?) -> Bool {
        guard let path = url?.path else { return false }
        return path == "/informatica" || path == "/informatica/" ||
            path == "/admin" || path == "/admin.html"
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(environment: environment, model: model)
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, PHPickerViewControllerDelegate {
        let environment: AppEnvironment
        let model: WebViewModel
        let refreshControl = UIRefreshControl()
        weak var webView: WKWebView?
        private var filePanelCompletion: (([URL]?) -> Void)?

        init(environment: AppEnvironment, model: WebViewModel) {
            self.environment = environment
            self.model = model
            super.init()
            refreshControl.addTarget(self, action: #selector(refresh), for: .valueChanged)
        }

        func userContentController(_ userContentController: WKUserContentController,
                                   didReceive message: WKScriptMessage) {
            let origin = message.frameInfo.securityOrigin
            guard message.frameInfo.isMainFrame,
                  matchesExpectedOrigin(origin)
            else { return }
            #if DEBUG
            if message.name == AuthDebugBridge.handlerName,
               let event = message.body as? String {
                authDebugLog(event)
                if event == "cookie/session may have changed" {
                    Task { @MainActor in _ = await model.hasSessionCookie() }
                }
                return
            }
            #endif
            guard message.name == WebNavigationBridge.handlerName,
                  let data = try? JSONSerialization.data(withJSONObject: message.body),
                  let snapshot = try? JSONDecoder().decode(WebNavigationSnapshot.self, from: data)
            else { return }
            // Message callbacks are outside SwiftUI's make/update pass.
            model.receiveNavigation(snapshot)
        }

        private func matchesExpectedOrigin(_ origin: WKSecurityOrigin) -> Bool {
            guard origin.protocol == environment.baseURL.scheme,
                  origin.host == environment.baseURL.host else { return false }
            let defaultPort = environment.baseURL.scheme == "https" ? 443 : 80
            let actualPort = origin.port == 0 ? defaultPort : origin.port
            let expectedPort = environment.baseURL.port ?? defaultPort
            return actualPort == expectedPort
        }

        @objc private func refresh() {
            webView?.reload()
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            appLogger.info("didStartProvisionalNavigation: \(webView.url?.absoluteString ?? "<nil>", privacy: .public)")
            model.receiveNavigation(WebNavigationSnapshot())
            model.webState = .loading
            model.isLoading = true
            model.connectionError = nil
            authDebugLog("web load started")
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            appLogger.info("didFinish: \(webView.url?.absoluteString ?? "<nil>", privacy: .public)")
            model.lastURL = webView.url
            model.webState = .finished
            model.isLoading = false
            refreshControl.endRefreshing()
            MiASPCHWebView.applyInformaticaBackground(to: webView)
            authDebugLog("web loaded")
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            let nsError = error as NSError
            appLogger.error("didFail: \(error.localizedDescription, privacy: .public), code: \(nsError.code)")
            model.webState = .failed
            model.lastErrorMessage = "\(error.localizedDescription) (código \(nsError.code))"
            handle(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            let nsError = error as NSError
            appLogger.error("didFailProvisionalNavigation: \(error.localizedDescription, privacy: .public), code: \(nsError.code)")
            model.webState = .failed
            model.lastErrorMessage = "\(error.localizedDescription) (código \(nsError.code))"
            handle(error)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            if shouldOpenExternally(url, navigationType: navigationAction.navigationType) {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }

        // WKWebView does not present the iOS photo picker for file inputs by itself.
        // PHPicker needs no photo-library permission and converts HEIC to JPEG before
        // returning the file URL consumed by the existing web upload flow.
        @available(iOS 18.4, *)
        func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                     initiatedByFrame frame: WKFrameInfo,
                     completionHandler: @escaping ([URL]?) -> Void) {
            guard let root = webView.window?.rootViewController else {
                completionHandler(nil)
                return
            }
            let presenter = topViewController(root)
            filePanelCompletion = completionHandler
            var configuration = PHPickerConfiguration(photoLibrary: .shared())
            configuration.filter = .images
            configuration.selectionLimit = parameters.allowsMultipleSelection ? 0 : 1
            let picker = PHPickerViewController(configuration: configuration)
            picker.delegate = self
            presenter.present(picker, animated: true)
        }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            picker.dismiss(animated: true)
            guard let completion = filePanelCompletion else { return }
            filePanelCompletion = nil
            guard let result = results.first else {
                completion(nil)
                return
            }
            result.itemProvider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, _ in
                let url: URL?
                if let data, let image = UIImage(data: data), let jpeg = image.jpegData(compressionQuality: 0.9) {
                    let target = FileManager.default.temporaryDirectory.appendingPathComponent("mi-aspch-photo-\(UUID().uuidString).jpg")
                    do {
                        try jpeg.write(to: target, options: .atomic)
                        url = target
                    } catch {
                        url = nil
                    }
                } else {
                    url = nil
                }
                DispatchQueue.main.async { completion(url.map { [$0] }) }
            }
        }

        private func topViewController(_ root: UIViewController) -> UIViewController {
            if let presented = root.presentedViewController { return topViewController(presented) }
            if let navigation = root as? UINavigationController, let visible = navigation.visibleViewController {
                return topViewController(visible)
            }
            if let tab = root as? UITabBarController, let selected = tab.selectedViewController {
                return topViewController(selected)
            }
            return root
        }

        private func shouldOpenExternally(_ url: URL, navigationType: WKNavigationType) -> Bool {
            guard let scheme = url.scheme?.lowercased() else {
                return false
            }

            if ["tel", "mailto", "maps"].contains(scheme) {
                return true
            }

            guard scheme == "http" || scheme == "https" else {
                return true
            }

            let host = url.host?.lowercased() ?? ""
            if host == "wa.me" || host.hasSuffix(".whatsapp.com") {
                return true
            }

            if url.pathExtension.lowercased() == "pdf" {
                return !environment.owns(url)
            }

            return !environment.owns(url) && navigationType == .linkActivated
        }

        private func handle(_ error: Error) {
            let nsError = error as NSError
            guard nsError.code != NSURLErrorCancelled else {
                appLogger.debug("Navigation cancelled (NSURLErrorCancelled)")
                return
            }

            model.isLoading = false
            refreshControl.endRefreshing()
            model.connectionError = error.localizedDescription
        }
    }
}

private extension UIView {
    var parentViewController: UIViewController? {
        var responder: UIResponder? = self
        while let current = responder {
            if let viewController = current as? UIViewController {
                return viewController
            }
            responder = current.next
        }
        return nil
    }
}


private final class WeakNavigationHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

struct WebNavigationItem: Codable, Equatable, Identifiable {
    let id: String
    let label: String

    var symbol: String {
        switch id {
        case "home", "admin-dashboard": return "house"
        case "parking", "admin-reservations": return "car"
        case "booking": return "calendar"
        case "profile", "admin-members": return "person.crop.circle"
        case "membership", "admin-finance": return "creditcard"
        case "convenios": return "gift"
        case "contact": return "phone"
        case "credential": return "person.text.rectangle"
        case "security", "admin-security", "action:account-menu-lock": return "lock"
        case "library": return "books.vertical"
        case "news": return "newspaper"
        case "marketplace": return "cart"
        case "activities": return "graduationcap"
        case "votes", "admin-votes": return "checkmark.seal"
        case "admin-audit": return "list.clipboard"
        case "action:account-menu-logout", "action:exit-simple-mode": return "rectangle.portrait.and.arrow.right"
        default: return "square.grid.2x2"
        }
    }
}

struct WebHomeQuickAccess: Codable, Equatable {
    var credentialTitle: String
    var credentialSubtitle: String
    var credentialBadge: String
    var credentialActive: Bool
    var hasEmergency: Bool
}

enum WebSessionState: String, Codable, Equatable {
    case unauthenticated = "unauthenticated"
    case locked = "locked"
    case authenticated = "authenticated"
    case unknown = "unknown"
}

struct WebNavigationSnapshot: Codable, Equatable {
    var primary: [WebNavigationItem] = []
    var secondary: [WebNavigationItem] = []
    var selected: String = ""
    var homeQuickAccess: WebHomeQuickAccess? = nil
    var sessionState: WebSessionState = .unknown
    var serverUnlocked: Bool? = nil
    var memberName: String? = nil
    var simpleMode: Bool = false
    var isAdmin: Bool = false
    var isAdminPanel: Bool = false
}

enum WebNavigationBridge {
    static let handlerName = "miASPCHNavigation"

    /// A DOM-only adapter in the page world. It neither reads
    /// credentials nor replaces go(), history, fetch, or the web auth gate.
    static func source(environment: AppEnvironment) -> String {
        let baseURL = String(data: try! JSONEncoder().encode(environment.baseURL.absoluteString), encoding: .utf8)!
        return #"""
        (() => {
            if (location.origin !== new URL(\#(baseURL)).origin || window.miASPCHNavigation) return;
            const style = document.createElement('style');
            style.textContent = `
                body.aspch-native-navigation {
                    margin: 0 !important; padding: 0 !important;
                    display: block !important; width: 100% !important;
                }
                body.aspch-native-navigation .app-shell:not(.hidden) {
                    display: block !important; width: 100% !important;
                    max-width: none !important; height: auto !important;
                    min-height: 100dvh !important; max-height: none !important;
                    margin: 0 !important; border: 0 !important; outline: 0 !important;
                    border-radius: 0 !important; box-shadow: none !important;
                }
                body.aspch-native-navigation .app-shell::before,
                body.aspch-native-navigation .app-shell::after,
                body.aspch-native-navigation .topbar,
                body.aspch-native-navigation #mobile-nav { display: none !important; }
                body.aspch-native-navigation .main-area {
                    display: block !important; height: auto !important;
                    padding-top: 0 !important; padding-bottom: 0 !important;
                    min-height: 100dvh !important;
                }
                body.aspch-native-navigation .view {
                    overflow-y: visible !important; padding-bottom: 16px !important;
                }
            `;
            document.head.append(style);
            let previous = '';
            var scheduled = false;
            var targets = new Map();
            const visible = element => element && !element.classList.contains('hidden');
            function read() {
                targets = new Map();
                const primary = [], secondary = [];
                const shell = document.getElementById('app-shell');
                const enabled = visible(shell) && !!document.querySelector('#mobile-nav [data-view]');
                if (document.body.classList.contains('aspch-native-navigation') !== !!enabled)
                    document.body.classList.toggle('aspch-native-navigation', !!enabled);

                let sessionState = 'unknown';
                const authEl = document.getElementById('auth-screen');
                const lockEl = document.getElementById('lock-screen');
                if (visible(shell)) {
                    sessionState = 'authenticated';
                } else if (visible(lockEl)) {
                    sessionState = 'locked';
                } else if (visible(authEl)) {
                    sessionState = 'unauthenticated';
                }

                const serverUnlocked = typeof state !== 'undefined' ? state.security?.unlocked === true : null;

                const memberName = typeof state !== 'undefined' ? state.member?.preferredName || state.member?.name || null : null;
                const isAdmin = typeof state !== 'undefined' && state.member?.role === 'ADMIN';
                const isAdminPanel = ['/informatica', '/informatica/', '/admin', '/admin.html'].includes(location.pathname);

                if (!enabled) return { primary, secondary, selected: '', homeQuickAccess: null, sessionState, serverUnlocked, memberName, simpleMode: false, isAdmin, isAdminPanel };
                const simple = document.body.classList.contains('simple-mode');
                const excludedSecondary = new Set(['credential', 'contact', 'action:account-menu-lock', 'action:account-menu-logout']);
                function add(button, list, action = false) {
                    const id = action ? 'action:' + button.id : button.dataset.view || button.dataset.accountView;
                    if (!id || targets.has(id) || button.disabled) return;
                    if (simple && !action && !['home', 'parking', 'contact'].includes(id)) return;
                    if (list === secondary && excludedSecondary.has(id)) return;
                    const copy = button.cloneNode(true);
                    if (!action) copy.querySelector('span')?.remove();
                    const label = copy.textContent.trim();
                    if (!label) return;
                    targets.set(id, button);
                    list.push({ id, label });
                }
                document.querySelectorAll('#mobile-nav [data-view]').forEach(b => add(b, primary));
                document.querySelectorAll('#mobile-more-nav [data-view], #account-menu [data-account-view]')
                    .forEach(b => add(b, secondary));
                const adminModeSwitch = document.getElementById('admin-mode-switch');
                if (visible(adminModeSwitch)) add(adminModeSwitch, secondary, true);
                // En modo simple no se publica "Salir del modo simple" como item
                // nativo: la salida vive discretamente dentro de Inicio web para
                // no convertirla en una pestaña principal.
                const active = document.querySelector('#mobile-nav .active[data-view], #desktop-nav .active[data-view], #mobile-more-nav .active[data-view]');
                let selected = active?.dataset.view || '';
                // These existing child views belong to Reservas; go() doesn't
                // mark a parent button active for them and doesn't change the URL.
                if (!selected && ['Turnos de simulador', 'Sala de estudios', 'Mi agenda']
                    .includes(document.getElementById('page-title')?.textContent)) selected = 'booking';

                let homeQuickAccess = null;
                const credEl = document.querySelector('#view [data-go="credential"]');
                if (credEl && enabled && (selected === 'home' || !selected)) {
                    const title = credEl.querySelector('strong')?.textContent?.trim() || 'Credencial vigente';
                    const subtitle = credEl.querySelector('.home-row-copy span')?.textContent?.trim() || 'Socio activo · Toca para abrir';
                    const badge = credEl.querySelector('.badge')?.textContent?.replace('→', '')?.trim() || 'Vigente';
                    const activeState = credEl.querySelector('.badge')?.classList?.contains('green') ?? true;
                    const emEl = document.querySelector('#view [data-go="emergency"]');
                    homeQuickAccess = {
                        credentialTitle: title,
                        credentialSubtitle: subtitle,
                        credentialBadge: badge,
                        credentialActive: activeState,
                        hasEmergency: !!emEl
                    };
                    targets.set('credential', credEl);
                    if (emEl) targets.set('emergency', emEl);
                }

                return { primary, secondary, selected, homeQuickAccess, sessionState, serverUnlocked, memberName, simpleMode: simple, isAdmin, isAdminPanel };
            }
            function publish() {
                scheduled = false;
                const snapshot = read();
                const serialized = JSON.stringify(snapshot);
                if (serialized === previous) return;
                previous = serialized;
                window.webkit.messageHandlers.miASPCHNavigation.postMessage(snapshot);
            }
            function schedule() {
                if (scheduled) return;
                scheduled = true;
                queueMicrotask(publish);
            }
            window.miASPCHNavigation = {
                activate(id) {
                    const snapshot = read();
                    if (id && id.startsWith('action:')) {
                        const actId = id.replace('action:', '');
                        const button = document.getElementById(actId);
                        if (button && !button.disabled) {
                            button.click();
                            schedule();
                            return true;
                        }
                    }
                    if (typeof window.go === 'function') {
                        window.go(id);
                        schedule();
                        return true;
                    }
                    const button = targets.get(id) || document.querySelector('#mobile-nav [data-view="' + id + '"], [data-view="' + id + '"], [data-account-view="' + id + '"], #view [data-go="' + id + '"]');
                    if (button && !button.disabled) {
                        button.click();
                        schedule();
                        return true;
                    }
                    return false;
                },
                async unlockWithPIN(pin) {
                    try {
                        const input = document.getElementById('unlock-pin');
                        if (input) input.value = pin;
                        const res = await fetch('/api/security/unlock', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'same-origin',
                            body: JSON.stringify({ pin: String(pin || '') })
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) {
                            return { success: false, error: data.error || 'PIN incorrecto.' };
                        }
                        if (typeof sessionStorage !== 'undefined') {
                            sessionStorage.setItem('miAspchUnlocked', '1');
                        }
                        if (typeof window.loginSuccess === 'function') {
                            window.loginSuccess();
                        }
                        schedule();
                        return { success: true };
                    } catch (e) {
                        return { success: false, error: e.message || 'Error de conexión.' };
                    }
                },
                logout() {
                    if (typeof window.doLogout === 'function') {
                        window.doLogout();
                    } else {
                        fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
                            .catch(() => {})
                            .then(() => location.reload());
                    }
                },
                toggleAdminPanel() {
                    if (typeof state === 'undefined' || state.member?.role !== 'ADMIN') return false;
                    location.assign(['/informatica', '/informatica/', '/admin', '/admin.html'].includes(location.pathname) ? '/' : '/informatica');
                    return true;
                },
                async exitSimpleMode() {
                    try {
                        const services = (typeof state !== 'undefined' && state.uiPreferences) ? (state.uiPreferences.services || {}) : {};
                        const res = await fetch('/api/profile/services', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'same-origin',
                            body: JSON.stringify({ services, simpleMode: false })
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) {
                            return { success: false, error: data.error || 'No fue posible salir del modo simple.' };
                        }
                        if (typeof state !== 'undefined' && data.uiPreferences) {
                            state.uiPreferences = typeof window.normalizedUiPreferences === 'function'
                                ? window.normalizedUiPreferences(data.uiPreferences)
                                : data.uiPreferences;
                        }
                        if (typeof window.renderNav === 'function') window.renderNav();
                        if (typeof window.go === 'function') await window.go('home');
                        schedule();
                        return { success: true };
                    } catch (err) {
                        return { success: false, error: err.message || 'Error de conexión.' };
                    }
                }
            };
            new MutationObserver(schedule).observe(document.body, {
                subtree: true, childList: true, attributes: true,
                attributeFilter: ['class', 'disabled', 'style'], characterData: true
            });
            window.addEventListener('pageshow', schedule);
            window.addEventListener('popstate', schedule);
            window.addEventListener('hashchange', schedule);
            publish();
        })();
        """#
    }
}

#if DEBUG
enum AuthDebugBridge {
    static let handlerName = "miASPCHAuthDebug"

    static let source = #"""
    (() => {
        if (window.__miASPCHAuthDebugInstalled) return;
        window.__miASPCHAuthDebugInstalled = true;
        const send = event => {
            try { window.webkit.messageHandlers.miASPCHAuthDebug.postMessage(String(event)); } catch (_) {}
        };
        const originalFetch = window.fetch.bind(window);
        window.fetch = async (...args) => {
            const raw = args[0] instanceof Request ? args[0].url : String(args[0] || '');
            const path = (() => { try { return new URL(raw, location.href).pathname; } catch (_) { return ''; } })();
            const watched = path === '/api/me' || path === '/api/auth/register/verify' ||
                path === '/api/security/pin' || path === '/api/security/unlock' ||
                path === '/api/auth/logout';
            if (path === '/api/security/pin' || path === '/api/security/unlock') send('PIN submit');
            if (path === '/api/me') send('web session check started');
            try {
                const response = await originalFetch(...args);
                if (watched) send(`${path} response status ${response.status}`);
                if (path === '/api/auth/register/verify' || path === '/api/security/pin' ||
                    path === '/api/security/unlock' || path === '/api/auth/logout') {
                    send('cookie/session may have changed');
                }
                return response;
            } catch (error) {
                if (watched) send(`${path} network error`);
                throw error;
            }
        };
        let previous = '';
        const report = () => {
            const visible = element => !!element && !element.classList.contains('hidden');
            const state = visible(document.getElementById('app-shell')) ? 'authenticated' :
                visible(document.getElementById('lock-screen')) ? 'locked' :
                visible(document.getElementById('auth-screen')) ? 'unauthenticated' : 'unknown';
            if (state === previous) return;
            previous = state;
            send(`web auth state ${state}`);
            if (state === 'authenticated') send('web auth completed');
        };
        const start = () => {
            send('web loaded');
            report();
            new MutationObserver(report).observe(document.body, {
                subtree: true, childList: true, attributes: true,
                attributeFilter: ['class', 'style']
            });
        };
        document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start, { once: true }) : start();
    })();
    """#
}
#endif

#if DEBUG
/// Temporary, local appearance-only diagnostics. No URLs, content, cookies or
/// user identifiers are exported. Used to inspect the physical iPhone directly.
@MainActor
enum AppearanceDiagnostics {
    static var generation = 0
    static func capture(colorScheme: ColorScheme, webView: WKWebView?) {
        generation += 1
        let current = generation
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(300))
            guard current == generation else { return }
            var report: [String: Any] = [
                "timestamp": ISO8601DateFormatter().string(from: Date()),
                "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") ?? "?",
                "swiftUI": colorScheme == .dark ? "dark" : "light",
                "sceneStyles": UIApplication.shared.connectedScenes.compactMap {
                    ($0 as? UIWindowScene)?.traitCollection.userInterfaceStyle.rawValue
                }
            ]
            if let webView {
                report["webKitStyle"] = webView.traitCollection.userInterfaceStyle.rawValue
                report["windowStyle"] = webView.window?.traitCollection.userInterfaceStyle.rawValue
                report["web"] = try? await webView.evaluateJavaScript("""
                    (() => ({
                        dark: matchMedia('(prefers-color-scheme: dark)').matches,
                        scheme: getComputedStyle(document.documentElement).colorScheme,
                        palette: getComputedStyle(document.documentElement).getPropertyValue('--bg'),
                        body: document.body ? getComputedStyle(document.body).backgroundColor : null,
                        auth: document.querySelector('#auth-screen') ? getComputedStyle(document.querySelector('#auth-screen')).backgroundColor : null
                    }))()
                    """)
            }
            guard current == generation,
                  let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
            else { return }
            let file = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("appearance-debug.json")
            try? data.write(to: file, options: .atomic)
        }
    }
}
#endif
