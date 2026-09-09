import SwiftUI
import OSLog
import UserNotifications

@main
struct MiASPCHApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var biometricAuthService = BiometricAuthService()
    @UIApplicationDelegateAdaptor(MiASPCHAppDelegate.self) private var appDelegate

    init() {
        appLogger.info("App start")
        let env = AppEnvironment.current
        #if DEBUG
        appLogger.info("Environment: DEBUG, URL: \(env.baseURL.absoluteString, privacy: .public)")
        #else
        appLogger.info("Environment: RELEASE, URL: \(env.baseURL.absoluteString, privacy: .public)")
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView(environment: .current)
                .environmentObject(biometricAuthService)
                .environmentObject(appDelegate.pushNotificationService)
                .task(id: scenePhase) {
                    guard scenePhase == .active else { return }
                    await appDelegate.pushNotificationService.refreshAuthorizationStatus()
                    appDelegate.pushNotificationService.registerForRemoteNotificationsIfAuthorized()
                }
        }
    }
}

@MainActor
final class MiASPCHAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    let pushNotificationService = PushNotificationService()

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        pushNotificationService.didRegisterForRemoteNotifications(deviceToken: deviceToken)
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        pushNotificationService.didFailToRegisterForRemoteNotifications(error)
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                           willPresent notification: UNNotification,
                                           withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // Also present a real system banner while the DEBUG test keeps the app open.
        completionHandler([.banner, .list, .sound])
        #if DEBUG
        let identifier = notification.request.identifier
        let testID = notification.request.content.userInfo["debugTestID"] as? String
        Task { @MainActor in
            if identifier == PushNotificationService.localTestIdentifier, let testID {
                pushNotificationService.didReceiveLocalTest(testID: testID)
            }
        }
        #endif
    }
}
