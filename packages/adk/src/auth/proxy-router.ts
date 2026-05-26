// ──────────────────────────────────────────────────────
// ADK Proxy Router — Resolve AIZona key → provider credentials
// ──────────────────────────────────────────────────────

export interface ADKApiKey {
  id: string;
  keyHash: string;
  type: "live" | "test";
  permissions: string[];
  active: boolean;
  ownerId: string;
}

/** Proxy router: resolves an ADK API key to underlying provider credentials */
export class ProxyRouter {
  private providerCredentials: Map<string, string>;

  constructor(providerCredentials: Map<string, string>) {
    this.providerCredentials = providerCredentials;
  }

  /**
   * Resolve a validated API key to provider credentials.
   * Returns the provider's API key and optional base URL.
   */
  resolve(_apiKey: ADKApiKey, providerId: string): { apiKey: string; baseUrl?: string } | null {
    const credential = this.providerCredentials.get(providerId);
    if (!credential) return null;
    return { apiKey: credential };
  }

  /** Check if a provider has credentials configured */
  hasProvider(providerId: string): boolean {
    return this.providerCredentials.has(providerId);
  }

  /** Get all configured provider IDs */
  getConfiguredProviders(): string[] {
    return Array.from(this.providerCredentials.keys());
  }
}
