import SwiftUI
import OSLog
import WebKit

private enum SessionStatus: Equatable {
    case checking
    case unauthenticated
    case authenticated
}

struct RootView: View {
    let environment: AppEnvironment

    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var colorScheme
    @EnvironmentObject private var biometricAuthService: BiometricAuthService
    @StateObject private var webViewModel = WebViewModel()
    @State private var isDocumentPickerPresented = false
    @State private var selectedDocument: SelectedDocument?
    @State private var documentError: String?
    @State private var sessionStatus: SessionStatus = .checking
    @State private var isUnlocked = false
    @State private var isAuthenticating = false
    @State private var authenticationError: String?
    @State private var failedAttempts = 0
    @State private var showPINEntry = false
    @State private var backgroundDate: Date? = nil
    @State private var initialSessionResolutionPending = true
    @State private var webLoginFlowWasShown = false

    var body: some View {
        ZStack {
            // A single persistent WebContainerView is always kept in the hierarchy.
            WebContainerView(
                environment: environment,
                model: webViewModel,
                isDocumentPickerPresented: $isDocumentPickerPresented,
                selectedDocument: $selectedDocument,
                documentError: $documentError
            )
            .opacity(sessionStatus == .unauthenticated || isUnlocked ? 1.0 : 0.0)
            .allowsHitTesting(sessionStatus == .unauthenticated || isUnlocked)

            if sessionStatus == .authenticated && !isUnlocked {
                Color(uiColor: .systemBackground)
                    .ignoresSafeArea()

                BiometricUnlockView(
                    memberName: webViewModel.navigation.memberName,
                    availability: biometricAuthService.availability,
                    isAuthenticating: isAuthenticating,
                    errorMessage: authenticationError,
                    failedAttempts: failedAttempts,
                    showPINEntry: $showPINEntry,
                    unlockWithBiometrics: unlockWithBiometrics,
                    unlockWithPIN: unlockWithPIN,
                    onLogout: onLogout
                )
                .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            (colorScheme == .dark
                ? Color(red: 0.020, green: 0.043, blue: 0.094)
                : Color(red: 0.965, green: 0.973, blue: 0.984))
                .ignoresSafeArea()
        }
        .task {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-debugResetSession") {
                await WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
            }
            #endif
            authDebugLog("session check started")
            let hasCookie = await webViewModel.hasSessionCookie()
            authDebugLog("session cookie at launch: \(hasCookie ? "observed" : "absent")")
            // A cookie is only a hint. The web gate validates it with /api/me;
            // native Face ID waits for that result before covering the web view.
            webViewModel.loadInitialIfNeeded(url: environment.baseURL)
        }
        .onChange(of: webViewModel.sessionState) { _, newState in
            authDebugLog("native observed web session state: \(newState.rawValue)")
            switch newState {
            case .unauthenticated:
                authDebugLog("session invalid")
                webLoginFlowWasShown = true
                sessionStatus = .unauthenticated
                isUnlocked = true
                failedAttempts = 0
                showPINEntry = false
                authenticationError = nil
            case .authenticated:
                authDebugLog("session valid")
                let shouldLock = initialSessionResolutionPending && !webLoginFlowWasShown
                initialSessionResolutionPending = false
                sessionStatus = .authenticated
                if shouldLock {
                    isUnlocked = false
                    authDebugLog("native lock shown")
                } else {
                    isUnlocked = true
                    authDebugLog("native lock hidden; WKWebView visible")
                }
            case .locked:
                authDebugLog("session valid; web gate locked")
                if initialSessionResolutionPending && !webLoginFlowWasShown && webViewModel.navigation.serverUnlocked == true {
                    initialSessionResolutionPending = false
                    sessionStatus = .authenticated
                    isUnlocked = false
                    authDebugLog("native lock shown")
                } else {
                    initialSessionResolutionPending = false
                    sessionStatus = .unauthenticated
                    isUnlocked = true
                    authDebugLog("native lock hidden; web lock remains visible")
                }
            case .unknown:
                break
            }
        }
        .onChange(of: scenePhase) { _, newPhase in
            authDebugLog("scenePhase \(String(describing: newPhase))")
            if newPhase == .background {
                backgroundDate = Date()
            } else if newPhase == .active {
                biometricAuthService.refreshAvailability()
                if sessionStatus == .authenticated {
                    if let bgDate = backgroundDate {
                        let elapsed = Date().timeIntervalSince(bgDate)
                        appLogger.info("Returned from background after \(elapsed, privacy: .public) seconds")
                        // Threshold of 30 seconds: re-lock if exceeded.
                        if elapsed >= 30.0 {
                            isUnlocked = false
                            failedAttempts = 0
                            showPINEntry = false
                            authenticationError = nil
                        }
                    }
                }
                backgroundDate = nil
            }
        }
        #if DEBUG
        .task(id: "\(scenePhase)-\(colorScheme)") {
            AppearanceDiagnostics.capture(colorScheme: colorScheme, webView: webViewModel.webView)
        }
        #endif
        .onAppear {
            appLogger.info("RootView appeared")
        }
    }

    private func unlockWithPIN(_ pin: String) {
        guard !isAuthenticating else { return }
        isAuthenticating = true
        authenticationError = nil
        Task { @MainActor in
            defer { isAuthenticating = false }
            if let errorMsg = await webViewModel.unlockWithPIN(pin) {
                authenticationError = errorMsg
            } else {
                withAnimation {
                    isUnlocked = true
                    failedAttempts = 0
                    showPINEntry = false
                    authenticationError = nil
                }
            }
        }
    }

    private func onLogout() {
        authDebugLog("logout requested")
        webViewModel.logout()
        withAnimation {
            initialSessionResolutionPending = false
            webLoginFlowWasShown = true
            sessionStatus = .unauthenticated
            isUnlocked = true
            failedAttempts = 0
            showPINEntry = false
            authenticationError = nil
        }
    }

    private func unlockWithBiometrics() {
        guard !isAuthenticating else { return }
        guard failedAttempts < 3 else {
            showPINEntry = true
            authenticationError = "Has alcanzado el límite de intentos. Ingresa tu PIN de Mi ASPCH."
            return
        }
        guard biometricAuthService.availability.canEvaluate && !biometricAuthService.availability.isLockedOut else {
            showPINEntry = true
            return
        }
        isAuthenticating = true
        authDebugLog("LocalAuthentication started")
        authenticationError = nil
        Task { @MainActor in
            defer { isAuthenticating = false }
            biometricAuthService.refreshAvailability()
            do {
                if try await biometricAuthService.authenticate() {
                    authDebugLog("LocalAuthentication succeeded")
                    if let errorMsg = await webViewModel.completeLocalUnlock() {
                        authenticationError = errorMsg
                        return
                    }
                    withAnimation {
                        isUnlocked = true
                        failedAttempts = 0
                        showPINEntry = false
                        authenticationError = nil
                    }
                } else {
                    enterPINFallback(message: "No se pudo verificar tu identidad. Ingresa tu PIN de Mi ASPCH.")
                }
            } catch let error as BiometricAuthError {
                authDebugLog("LocalAuthentication ended: \(String(describing: error))")
                switch error {
                case .cancelled:
                    enterPINFallback(message: "Ingresa tu PIN de Mi ASPCH para continuar.")
                case .lockout:
                    enterPINFallback(message: "Face ID bloqueado por el sistema. Ingresa tu PIN de Mi ASPCH.")
                case .failed(let message):
                    enterPINFallback(message: "\(message) Ingresa tu PIN de Mi ASPCH.")
                case .unavailable(let message):
                    enterPINFallback(message: message)
                }
            } catch {
                enterPINFallback(message: "\(error.localizedDescription) Ingresa tu PIN de Mi ASPCH.")
            }
        }
    }

    private func enterPINFallback(message: String) {
        failedAttempts = 3
        showPINEntry = true
        authenticationError = message
    }
}
