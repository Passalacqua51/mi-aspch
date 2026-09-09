import SwiftUI

struct ConnectionErrorView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 34))
                .foregroundStyle(.secondary)

            VStack(spacing: 6) {
                Text("No se pudo conectar")
                    .font(.headline)
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            if #available(iOS 26.0, *) {
                Button("Reintentar", action: retry)
                    .buttonStyle(.glassProminent)
            } else {
                Button("Reintentar", action: retry)
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(24)
        .frame(maxWidth: 320)
        .liquidGlass(cornerRadius: 16, fallbackMaterial: .regularMaterial)
        .padding()
    }
}
