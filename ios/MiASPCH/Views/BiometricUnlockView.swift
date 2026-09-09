import SwiftUI
import LocalAuthentication

struct BiometricUnlockView: View {
    @Environment(\.colorScheme) private var colorScheme

    let memberName: String?
    let availability: BiometricAvailability
    let isAuthenticating: Bool
    let errorMessage: String?
    let failedAttempts: Int
    @Binding var showPINEntry: Bool
    let unlockWithBiometrics: () -> Void
    let unlockWithPIN: (String) -> Void
    let onLogout: () -> Void

    @State private var pin: String = ""
    @FocusState private var isPinFocused: Bool

    private var isInPINMode: Bool {
        showPINEntry || failedAttempts >= 3 || availability.isLockedOut || !availability.canEvaluate
    }

    private var greeting: String {
        guard let memberName,
              let firstName = memberName.split(separator: " ").first
        else { return "Hola" }
        return "Hola \(firstName)"
    }

    private var primaryColor: Color {
        colorScheme == .dark
            ? Color(red: 0.255, green: 0.443, blue: 0.788)
            : Color(red: 0.078, green: 0.200, blue: 0.424)
    }

    var body: some View {
        VStack(spacing: 18) {
            Image("ASPCHLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .accessibilityHidden(true)

            Text(greeting)
                .font(.title3.weight(.semibold))

            if isInPINMode {
                pinSection
            } else {
                biometricSection
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }

            if isInPINMode {
                Button("Cerrar sesión / Usar otra cuenta", action: onLogout)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.top, 4)
            }
        }
        .padding(24)
        .frame(maxWidth: 340)
        .liquidGlass(cornerRadius: 16, fallbackMaterial: .regularMaterial)
        .padding()
        .onAppear {
            if isInPINMode {
                isPinFocused = true
            }
        }
        .onChange(of: isInPINMode) { _, inPIN in
            if inPIN {
                isPinFocused = true
            }
        }
    }

    @ViewBuilder
    private var biometricSection: some View {
        VStack(spacing: 10) {
            if availability.canEvaluate {
                Group {
                    if #available(iOS 26.0, *) {
                        Button(failedAttempts > 0 ? "Reintentar" : "Acceder", action: unlockWithBiometrics)
                            .buttonStyle(.glassProminent)
                    } else {
                        Button(failedAttempts > 0 ? "Reintentar" : "Acceder", action: unlockWithBiometrics)
                            .buttonStyle(.borderedProminent)
                    }
                }
                .tint(primaryColor)
                .controlSize(.large)
                .frame(maxWidth: .infinity)
                .disabled(isAuthenticating)

                if failedAttempts > 0 {
                    Text("Intento fallido \(failedAttempts) de 3")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private var pinSection: some View {
        VStack(spacing: 12) {
            if failedAttempts >= 3 {
                Text("Has alcanzado el límite de intentos de \(availability.displayName). Ingresa tu PIN de Mi ASPCH.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            } else if availability.isLockedOut {
                Text("Face ID está bloqueado temporalmente. Ingresa tu PIN de Mi ASPCH.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            } else {
                Text("Ingresa tu PIN de Mi ASPCH para continuar.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            SecureField("PIN de 4 dígitos", text: $pin)
                .keyboardType(.numberPad)
                .textContentType(.password)
                .focused($isPinFocused)
                .multilineTextAlignment(.center)
                .font(.title3.monospaced())
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(Color(uiColor: .tertiarySystemFill))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .disabled(isAuthenticating)
                .submitLabel(.go)
                .onSubmit {
                    submitPIN()
                }
                .onChange(of: pin) { _, newValue in
                    let sanitized = newValue.filter(\.isNumber).prefix(4)
                    let next = String(sanitized)
                    if pin != next {
                        pin = next
                    }
                }

            Group {
                if #available(iOS 26.0, *) {
                    Button("Acceder", action: submitPIN)
                        .buttonStyle(.glassProminent)
                } else {
                    Button("Acceder", action: submitPIN)
                        .buttonStyle(.borderedProminent)
                }
            }
            .tint(primaryColor)
            .controlSize(.large)
            .frame(maxWidth: .infinity)
            .disabled(pin.count != 4 || isAuthenticating)

            if failedAttempts < 3 && availability.canEvaluate && !availability.isLockedOut {
                Button("Volver a \(availability.displayName)") {
                    showPINEntry = false
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(primaryColor)
                .padding(.top, 2)
            }
        }
    }

    private func submitPIN() {
        guard pin.count == 4 && !isAuthenticating else { return }
        let candidate = pin
        pin = ""
        unlockWithPIN(candidate)
    }
}
