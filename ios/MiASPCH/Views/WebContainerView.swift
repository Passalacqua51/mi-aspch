import SwiftUI
import OSLog
import WebKit

struct WebContainerView: View {
    let environment: AppEnvironment
    @Environment(\.colorScheme) private var colorScheme
    @ObservedObject var model: WebViewModel
    @Binding var isDocumentPickerPresented: Bool
    @Binding var selectedDocument: SelectedDocument?
    @Binding var documentError: String?

    #if DEBUG
    @EnvironmentObject private var pushNotificationService: PushNotificationService
    @State private var isDiagnosticsPresented = false
    #endif

    var body: some View {
        webContent
            .overlay(alignment: .bottom) {
                if !model.navigation.primary.isEmpty {
                    NativeNavigationBar(model: model)
                        .padding(.bottom, 8)
                }
            }
            #if DEBUG
            .overlay(alignment: .topTrailing) {
                VStack(alignment: .trailing, spacing: 8) {
                    Button {
                        isDiagnosticsPresented.toggle()
                    } label: {
                        Image(systemName: "stethoscope")
                            .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel("Diagnóstico DEBUG")
                    .modifier(NativeGlassButtonModifier())
                    if isDiagnosticsPresented {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("DEBUG · \(model.webState.rawValue)").font(.headline)
                            Text(environment.baseURL.absoluteString)
                            Text("Apariencia iOS: \(colorScheme == .dark ? "oscura" : "clara")")
                            Text("Build: \(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—")")
                            Text("WKWebView: \(model.webView == nil ? "0" : "1")")
                            if let status = model.connectivityStatus { Text(status) }
                            if let error = model.lastErrorMessage ?? model.connectionError {
                                Text(error).foregroundStyle(.red)
                            }
                            Button("Recargar") { model.reload() }
                            Button("Cerrar sesión (DEBUG)") { model.logout() }
                            Button("Limpiar cookies (DEBUG)") {
                                WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {
                                    model.reload()
                                }
                            }
                            Divider()
                            Text("Notificaciones: \(pushNotificationService.status.rawValue)")
                            Text(pushNotificationService.remoteStatus)
                            Button("Probar notificación local (5 s)") {
                                Task { await pushNotificationService.scheduleLocalTest() }
                            }
                            .accessibilityIdentifier("debug-local-notification")
                            .disabled(pushNotificationService.isTesting)
                            Text(pushNotificationService.localTestStatus)
                        }
                        .font(.caption)
                        .padding()
                        .liquidGlass(cornerRadius: 12)
                        .frame(maxWidth: 300)
                    }
                }
                .padding(8)
            }
            #endif
    }

    private var webContent: some View {
        ZStack {
            MiASPCHWebView(environment: environment, model: model)
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            if model.isLoading {
                LoadingView()
                    .allowsHitTesting(false)
            }

            if let connectionError = model.connectionError {
                ConnectionErrorView(message: connectionError) {
                    model.reload()
                }
            }
        }
        .onAppear {
            appLogger.info("WebContainerView appeared")
        }
        .safeAreaInset(edge: .bottom) {
            if let selectedDocument {
                DocumentSelectionBanner(document: selectedDocument)
            } else if let documentError {
                Text(documentError)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                    .background(.bar)
            }
        }
        .sheet(isPresented: $isDocumentPickerPresented) {
            PDFDocumentPicker(selectedDocument: $selectedDocument, errorMessage: $documentError)
        }
    }
}

/// The web surface never moves between tab subtrees. A single native bar adapts
/// to the web's member, simple-mode and admin navigation, including its menus.
private struct NativeNavigationBar: View {
    @ObservedObject var model: WebViewModel
    @Namespace private var navNamespace
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @State private var optimisticSelectedId: String? = nil

    private var selectedId: String {
        if let optimistic = optimisticSelectedId {
            return optimistic
        }
        let current = model.navigation.selected
        if model.navigation.primary.contains(where: { $0.id == current }) {
            return current
        }
        if !model.navigation.secondary.isEmpty && !current.isEmpty {
            return "more"
        }
        return model.navigation.primary.first?.id ?? ""
    }

    var body: some View {
        barContent
            .padding(.horizontal, 24)
            .padding(.vertical, 4)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Navegación principal")
    }

    @ViewBuilder
    private var barContent: some View {
        innerBar
            .background(mainBarBackground)
            .clipShape(Capsule())
            .overlay(mainBarBorder)
            .shadow(color: Color.black.opacity(colorScheme == .dark ? 0.28 : 0.12), radius: 14, x: 0, y: 5)
    }

    private var innerBar: some View {
        HStack(spacing: 4) {
            ForEach(model.navigation.primary) { item in
                Button {
                    withAnimation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.75)) {
                        optimisticSelectedId = item.id
                    }
                    model.activate(item)
                } label: {
                    tabItemView(
                        id: item.id,
                        label: item.label,
                        symbol: symbol(for: item, isSelected: selectedId == item.id),
                        isSelected: selectedId == item.id
                    )
                }
                .accessibilityLabel(item.label)
                .accessibilityAddTraits(selectedId == item.id ? .isSelected : [])
                .accessibilityIdentifier("native-nav-" + item.id)
            }

            if !model.navigation.secondary.isEmpty {
                Menu {
                    ForEach(model.navigation.secondary) { item in
                        Button {
                            withAnimation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.75)) {
                                optimisticSelectedId = "more"
                            }
                            model.activate(item)
                        } label: {
                            Label(item.label, systemImage: item.symbol)
                        }
                    }
                    Divider()
                    Button("Recargar", systemImage: "arrow.clockwise") {
                        model.reload()
                    }
                } label: {
                    tabItemView(
                        id: "more",
                        label: "Más",
                        symbol: "ellipsis",
                        isSelected: selectedId == "more"
                    )
                }
                .accessibilityLabel("Más servicios y cuenta")
                .accessibilityAddTraits(selectedId == "more" ? .isSelected : [])
                .accessibilityIdentifier("native-nav-more")
            }
        }
        .buttonStyle(.plain)
        .padding(5)
        .frame(height: 56)
        .animation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.75), value: selectedId)
        .onChange(of: model.navigation.selected) { _, newSelected in
            if optimisticSelectedId == newSelected || (optimisticSelectedId == "more" && !model.navigation.primary.contains(where: { $0.id == newSelected })) {
                optimisticSelectedId = nil
            }
        }
    }

    private func tabItemView(id: String, label: String, symbol: String, isSelected: Bool) -> some View {
        ZStack {
            if isSelected {
                activePill
            }

            Image(systemName: symbol)
                .font(.system(size: 21, weight: isSelected ? .semibold : .regular))
                .foregroundStyle(iconColor(isSelected: isSelected))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var activePill: some View {
        ActiveMaterialPill()
            .matchedGeometryEffect(id: "activeTabPill", in: navNamespace)
    }

    @ViewBuilder
    private var mainBarBackground: some View {
        if reduceTransparency {
            Capsule()
                .fill(colorScheme == .dark ? ASPCHPalette.darkSurface : ASPCHPalette.lightSurface)
        } else {
            Capsule()
                .fill((colorScheme == .dark ? ASPCHPalette.darkSurface : ASPCHPalette.lightSurface).opacity(colorScheme == .dark ? 0.97 : 0.94))
                .background(Capsule().fill(.regularMaterial))
        }
    }

    private var mainBarBorder: some View {
        Capsule()
            .strokeBorder(
                (colorScheme == .dark ? ASPCHPalette.primary.opacity(0.44) : ASPCHPalette.primary.opacity(0.16)),
                lineWidth: 0.75
            )
    }

    private func iconColor(isSelected: Bool) -> Color {
        if isSelected {
            return activeNavigationColor
        } else {
            return (colorScheme == .dark ? ASPCHPalette.textDark : ASPCHPalette.textLight).opacity(colorScheme == .dark ? 0.78 : 0.66)
        }
    }

    private var activeNavigationColor: Color {
        colorScheme == .dark ? ASPCHPalette.primaryDark : ASPCHPalette.primary
    }

    private func symbol(for item: WebNavigationItem, isSelected: Bool) -> String {
        if isSelected {
            switch item.id {
            case "home", "admin-dashboard": return "house.fill"
            case "parking": return "car.fill"
            case "booking", "admin-reservations": return "calendar"
            case "profile", "admin-members": return "person.crop.circle.fill"
            case "credential": return "person.text.rectangle.fill"
            default: return item.symbol
            }
        }
        return item.symbol
    }
}

private struct ActiveMaterialPill: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    private var activeNavigationColor: Color {
        colorScheme == .dark ? ASPCHPalette.primaryDark : ASPCHPalette.primary
    }

    var body: some View {
        if reduceTransparency {
            Capsule()
                .fill(activeNavigationColor.opacity(colorScheme == .dark ? 0.46 : 0.22))
        } else {
            Capsule()
                .fill(activeNavigationColor.opacity(colorScheme == .dark ? 0.42 : 0.18))
                .background(Capsule().fill(.thinMaterial))
                .overlay(
                    Capsule()
                        .strokeBorder(activeNavigationColor.opacity(colorScheme == .dark ? 0.72 : 0.36), lineWidth: 0.75)
                )
                .shadow(color: Color.black.opacity(colorScheme == .dark ? 0.22 : 0.10), radius: 3, x: 0, y: 1)
        }
    }
}

private enum ASPCHPalette {
    static let primary = Color(red: 0.078, green: 0.200, blue: 0.424)
    static let primaryDark = Color(red: 0.255, green: 0.443, blue: 0.788)
    static let accent = Color(red: 0.843, green: 0.149, blue: 0.239)
    static let lightSurface = Color(red: 0.965, green: 0.973, blue: 0.984)
    static let darkSurface = Color(red: 0.020, green: 0.043, blue: 0.094)
    static let textLight = Color(red: 0.027, green: 0.102, blue: 0.200)
    static let textDark = Color.white
}

struct LiquidGlassModifier: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    var cornerRadius: CGFloat = 12
    var fallbackMaterial: Material = .regularMaterial

    func body(content: Content) -> some View {
        if reduceTransparency {
            content
                .background(Color(uiColor: .secondarySystemBackground))
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
        } else if #available(iOS 26.0, *) {
            if cornerRadius > 0 {
                content.glassEffect(.regular, in: RoundedRectangle(cornerRadius: cornerRadius))
            } else {
                content.glassEffect(.regular, in: Rectangle())
            }
        } else {
            if cornerRadius > 0 {
                content
                    .background(fallbackMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
            } else {
                content.background(fallbackMaterial)
            }
        }
    }
}

extension View {
    func liquidGlass(cornerRadius: CGFloat = 12, fallbackMaterial: Material = .regularMaterial) -> some View {
        modifier(LiquidGlassModifier(cornerRadius: cornerRadius, fallbackMaterial: fallbackMaterial))
    }
}

private struct NativeGlassButtonModifier: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.buttonStyle(.glass)
        } else {
            content.buttonStyle(.bordered)
        }
    }
}
