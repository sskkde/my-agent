import type { TargetRuntime, RuntimeAdapter, AdapterRegistry } from './types.js'

class AdapterRegistryImpl implements AdapterRegistry {
  private adapters = new Map<TargetRuntime, RuntimeAdapter>()

  register(runtimeType: TargetRuntime, adapter: RuntimeAdapter): void {
    this.adapters.set(runtimeType, adapter)
  }

  getAdapter(runtimeType: TargetRuntime): RuntimeAdapter | null {
    return this.adapters.get(runtimeType) ?? null
  }

  unregister(runtimeType: TargetRuntime): void {
    this.adapters.delete(runtimeType)
  }

  listAdapters(): TargetRuntime[] {
    return Array.from(this.adapters.keys())
  }
}

export function createAdapterRegistry(): AdapterRegistry {
  return new AdapterRegistryImpl()
}
