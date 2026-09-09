import Foundation
import Combine
import LocalAuthentication

struct BiometricAvailability: Equatable {
    let canEvaluate: Bool
    let biometryType: LABiometryType
    let errorDescription: String?
    let hasBiometrics: Bool
    let isLockedOut: Bool

    var displayName: String {
        if hasBiometrics {
            switch biometryType {
            case .faceID:
                return "Face ID"
            case .touchID:
                return "Touch ID"
            default:
                return "Biometría"
            }
        } else {
            return "PIN de Mi ASPCH"
        }
    }
}

enum BiometricAuthError: LocalizedError {
    case cancelled
    case unavailable(String)
    case failed(String)
    case lockout

    var errorDescription: String? {
        switch self {
        case .cancelled:
            return "Autenticación cancelada."
        case .unavailable(let message):
            return message
        case .failed(let message):
            return message
        case .lockout:
            return "Face ID bloqueado por el sistema. Usa tu PIN de Mi ASPCH."
        }
    }
}

@MainActor
final class BiometricAuthService: ObservableObject {
    @Published private(set) var availability: BiometricAvailability

    init() {
        availability = Self.evaluateAvailability()
    }

    func refreshAvailability() {
        availability = Self.evaluateAvailability()
    }

    func authenticate(reason: String = "Desbloquear Mi ASPCH") async throws -> Bool {
        let context = LAContext()
        context.localizedCancelTitle = "Cancelar"
        // An empty fallback title suppresses the iOS device passcode button,
        // ensuring only Mi ASPCH's own PIN or Face ID is accepted.
        context.localizedFallbackTitle = ""

        var error: NSError?
        let policy: LAPolicy = .deviceOwnerAuthenticationWithBiometrics

        guard context.canEvaluatePolicy(policy, error: &error) else {
            if let laError = error as? LAError, laError.code == .biometryLockout {
                throw BiometricAuthError.lockout
            }
            let message = error?.localizedDescription ?? "La biometría no está disponible en este dispositivo."
            throw BiometricAuthError.unavailable(message)
        }

        do {
            return try await context.evaluatePolicy(policy, localizedReason: reason)
        } catch {
            if let laError = error as? LAError {
                switch laError.code {
                case .userCancel, .appCancel, .systemCancel:
                    throw BiometricAuthError.cancelled
                case .biometryLockout:
                    throw BiometricAuthError.lockout
                case .authenticationFailed:
                    throw BiometricAuthError.failed("No se pudo verificar tu identidad.")
                default:
                    throw BiometricAuthError.failed(laError.localizedDescription)
                }
            }
            throw BiometricAuthError.failed("No se pudo verificar tu identidad. Intenta nuevamente.")
        }
    }

    private static func evaluateAvailability() -> BiometricAvailability {
        let context = LAContext()
        var bioError: NSError?
        let canEvaluateBio = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &bioError)
        let isLockedOut = (bioError as? LAError)?.code == .biometryLockout

        return BiometricAvailability(
            canEvaluate: canEvaluateBio,
            biometryType: context.biometryType,
            errorDescription: isLockedOut ? "Face ID bloqueado temporalmente por intentos fallidos." : bioError?.localizedDescription,
            hasBiometrics: context.biometryType == .faceID || context.biometryType == .touchID,
            isLockedOut: isLockedOut
        )
    }
}
