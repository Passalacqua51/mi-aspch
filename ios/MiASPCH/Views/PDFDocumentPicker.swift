import SwiftUI
import UniformTypeIdentifiers

struct PDFDocumentPicker: UIViewControllerRepresentable {
    @Binding var selectedDocument: SelectedDocument?
    @Binding var errorMessage: String?

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.pdf], asCopy: true)
        picker.delegate = context.coordinator
        picker.allowsMultipleSelection = false
        return picker
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(selectedDocument: $selectedDocument, errorMessage: $errorMessage)
    }

    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        @Binding private var selectedDocument: SelectedDocument?
        @Binding private var errorMessage: String?
        private let service = DocumentSelectionService()

        init(selectedDocument: Binding<SelectedDocument?>, errorMessage: Binding<String?>) {
            _selectedDocument = selectedDocument
            _errorMessage = errorMessage
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let url = urls.first else { return }

            do {
                selectedDocument = try service.makeSelectedDocument(from: url)
                errorMessage = nil
            } catch {
                selectedDocument = nil
                errorMessage = "No se pudo leer el PDF seleccionado."
            }
        }
    }
}
