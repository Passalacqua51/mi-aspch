import Foundation
import OSLog

let appLogger = Logger(
    subsystem: Bundle.main.bundleIdentifier ?? "org.aspch.Mi-ASPCH",
    category: "MiASPCH"
)

#if DEBUG
func authDebugLog(_ event: String) {
    print("[AUTH] \(event)")
}
#else
@inline(__always) func authDebugLog(_ event: String) {}
#endif

struct AppEnvironment {
    let baseURL: URL
    let displayName: String

    static var current: AppEnvironment {
        #if DEBUG
        return AppEnvironment(
            baseURL: URL(string: "https://distant-jackets-reward-walt.trycloudflare.com")!,
            displayName: "Mi ASPCH Preview"
        )
        #else
        return AppEnvironment(
            baseURL: URL(string: "https://app.aspch.org")!,
            displayName: "Mi ASPCH"
        )
        #endif
    }

    func owns(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased(), let baseHost = baseURL.host?.lowercased() else {
            return false
        }

        return host == baseHost
    }
}
