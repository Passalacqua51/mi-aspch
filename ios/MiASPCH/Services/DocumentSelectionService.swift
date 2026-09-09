import Foundation

struct DocumentSelectionService {
    func makeSelectedDocument(from url: URL) throws -> SelectedDocument {
        let shouldStopAccessing = url.startAccessingSecurityScopedResource()
        defer {
            if shouldStopAccessing {
                url.stopAccessingSecurityScopedResource()
            }
        }

        let values = try url.resourceValues(forKeys: [.fileSizeKey, .totalFileAllocatedSizeKey, .nameKey])
        let byteSize = Int64(values.fileSize ?? values.totalFileAllocatedSize ?? 0)
        let fileName = values.name ?? url.lastPathComponent

        return SelectedDocument(url: url, fileName: fileName, byteSize: byteSize)
    }
}
