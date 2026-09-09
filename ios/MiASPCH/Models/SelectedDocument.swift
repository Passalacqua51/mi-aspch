import Foundation

struct SelectedDocument: Identifiable, Equatable {
    let id = UUID()
    let url: URL
    let fileName: String
    let byteSize: Int64

    var formattedSize: String {
        ByteCountFormatter.string(fromByteCount: byteSize, countStyle: .file)
    }
}
