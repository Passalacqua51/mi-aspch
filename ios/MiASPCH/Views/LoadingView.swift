import SwiftUI

struct LoadingView: View {
    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text("Cargando Mi ASPCH")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(20)
        .liquidGlass(cornerRadius: 12, fallbackMaterial: .regularMaterial)
    }
}
