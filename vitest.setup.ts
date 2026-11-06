// Any setup scripts you might need go here

// Load .env files
import 'dotenv/config'

// Fix cross-realm Uint8Array instanceof check in Vitest JSDOM environment
if (typeof Uint8Array !== 'undefined') {
  try {
    Object.defineProperty(Uint8Array, Symbol.hasInstance, {
      value: (instance: unknown) => {
        return (
          instance !== null &&
          typeof instance === 'object' &&
          ((instance as any).constructor?.name === 'Uint8Array' ||
            ArrayBuffer.isView(instance))
        )
      },
      configurable: true,
    })
  } catch {
    // Ignore
  }
}
