import Foundation
import Combine
import UIKit
import UserNotifications

@MainActor
final class PushNotificationService: ObservableObject {
    enum Status: String {
        case notConfigured = "Sin solicitar"
        case denied = "Denegado"
        case authorized = "Concedido"
        case provisional = "Provisional"
        case ephemeral = "Temporal"
        case unknown = "Desconocido"
    }

    @Published private(set) var status: Status = .notConfigured
    @Published private(set) var remoteStatus = "Sin registrar"
    @Published private(set) var hasDeviceToken = false
    // Native APNs tokens are not Web Push subscriptions. Keep the token in memory
    // until a separately authorized APNs backend integration exists; never log it.
    private(set) var deviceToken: Data?
    private var registrationAttempted = false
    private let center = UNUserNotificationCenter.current()

    func refreshAuthorizationStatus() async {
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .notDetermined: status = .notConfigured
        case .denied: status = .denied
        case .authorized: status = .authorized
        case .provisional: status = .provisional
        case .ephemeral: status = .ephemeral
        @unknown default: status = .unknown
        }
        #if DEBUG
        writeDiagnostics()
        #endif
    }

    @discardableResult
    func requestAuthorization() async throws -> Bool {
        let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
        await refreshAuthorizationStatus()
        if granted { registerForRemoteNotificationsIfAuthorized() }
        return granted
    }

    func registerForRemoteNotificationsIfAuthorized() {
        guard [.authorized, .provisional, .ephemeral].contains(status),
              !registrationAttempted else { return }
        registrationAttempted = true
        remoteStatus = "Registrando con APNs…"
        // Without the signed aps-environment entitlement, iOS must report failure
        // through UIApplicationDelegate. A local permission grant isn't APNs success.
        UIApplication.shared.registerForRemoteNotifications()
    }

    func didRegisterForRemoteNotifications(deviceToken: Data) {
        self.deviceToken = deviceToken
        hasDeviceToken = true
        remoteStatus = "Token obtenido; integración backend APNs pendiente"
        #if DEBUG
        writeDiagnostics()
        #endif
    }

    func didFailToRegisterForRemoteNotifications(_ error: Error) {
        deviceToken = nil
        hasDeviceToken = false
        remoteStatus = "APNs no disponible: \(error.localizedDescription)"
        #if DEBUG
        writeDiagnostics()
        #endif
    }

    #if DEBUG
    static let localTestIdentifier = "mi-aspch.debug.local-test"
    @Published private(set) var localTestStatus = "Sin probar"
    @Published private(set) var isTesting = false
    private var localTestID: String?
    private var scheduledAt: Date?
    private var receivedAt: Date?

    func scheduleLocalTest() async {
        guard !isTesting else { return }
        isTesting = true
        defer { isTesting = false; writeDiagnostics() }
        do {
            guard try await requestAuthorization() else {
                localTestStatus = "Permiso denegado; revisa Ajustes de notificaciones"
                return
            }
            let content = UNMutableNotificationContent()
            content.title = "Mi ASPCH · Prueba local"
            content.body = "Esta notificación local funciona sin APNs ni backend."
            content.sound = .default
            let testID = UUID().uuidString
            content.userInfo = ["debugTestID": testID]
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 5, repeats: false)
            let request = UNNotificationRequest(identifier: Self.localTestIdentifier,
                                                content: content, trigger: trigger)
            try await center.add(request)
            localTestID = testID
            scheduledAt = Date()
            receivedAt = nil
            localTestStatus = "Programada para dentro de 5 segundos"
        } catch {
            localTestStatus = "Error: \(error.localizedDescription)"
        }
    }

    func didReceiveLocalTest(testID: String) {
        guard testID == localTestID else { return }
        receivedAt = Date()
        localTestStatus = "Recibida por iOS; presentación de banner solicitada"
        writeDiagnostics()
    }

    /// Fixed, local diagnostics only. No token, payload, account or device identifiers.
    private func writeDiagnostics() {
        let report: [String: Any] = [
            "authorization": status.rawValue,
            "deviceTokenObtained": hasDeviceToken,
            "remoteStatus": remoteStatus,
            "localTestStatus": localTestStatus,
            "scheduledAt": scheduledAt?.timeIntervalSince1970 as Any? ?? NSNull(),
            "receivedAt": receivedAt?.timeIntervalSince1970 as Any? ?? NSNull()
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) else { return }
        let file = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("notifications-debug.json")
        try? data.write(to: file, options: .atomic)
    }
    #endif
}
