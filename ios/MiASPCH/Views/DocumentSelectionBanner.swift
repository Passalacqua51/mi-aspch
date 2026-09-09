import SwiftUI

struct DocumentSelectionBanner: View {
    let document: SelectedDocument

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "doc.richtext")
                .foregroundStyle(.accent)

            VStack(alignment: .leading, spacing: 2) {
                Text(document.fileName)
                    .font(.footnote.weight(.semibold))
                    .lineLimit(1)
                Text(document.formattedSize)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .liquidGlass(cornerRadius: 0, fallbackMaterial: .bar)
    }
}
