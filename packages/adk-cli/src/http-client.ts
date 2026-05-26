// ──────────────────────────────────────────────────────
// CLI HTTP Client — Communicates with ADK Server
// ──────────────────────────────────────────────────────

import { getApiKey, getApiUrl } from "./config";

export class ADKClient {
  constructor(
    private baseUrl: string,
    private apiKey?: string,
  ) {}

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(url, { ...options, headers });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body}`);
    }

    return res.json();
  }

  /** Check server health */
  async checkHealth(): Promise<{ status: string; version: string }> {
    return this.request("/health");
  }

  /** List registered agents */
  async listAgents(): Promise<{ agents: any[]; total: number }> {
    return this.request("/v1/agents");
  }

  /** Register a new agent */
  async registerAgent(data: {
    name: string;
    config?: unknown;
    version?: string;
    metadata?: unknown;
  }): Promise<any> {
    return this.request("/v1/agents", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /** Create and execute a run */
  async createRun(data: { input: string; agentId?: string }): Promise<any> {
    return this.request("/v1/runs", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /** Create an API key */
  async createKey(data: { name?: string; type?: "live" | "test" }): Promise<any> {
    return this.request("/v1/keys", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /** List API keys */
  async listKeys(): Promise<{ keys: any[]; total: number }> {
    return this.request("/v1/keys");
  }

  /** Revoke an API key */
  async revokeKey(id: string): Promise<any> {
    return this.request(`/v1/keys/${id}`, { method: "DELETE" });
  }

  /** Get usage stats */
  async getUsage(): Promise<any> {
    return this.request("/v1/usage");
  }

  /** Search community skills */
  async searchSkills(params: {
    search?: string;
    communityId?: string;
    category?: string;
    limit?: number;
  }): Promise<{ items: any[]; nextCursor: string | null }> {
    const query = new URLSearchParams();
    if (params.search) query.set("search", params.search);
    if (params.communityId) query.set("communityId", params.communityId);
    if (params.category) query.set("category", params.category);
    if (params.limit) query.set("limit", String(params.limit));
    return this.request(`/v1/skills?${query.toString()}`);
  }

  /** Publish a skill to the marketplace */
  async publishSkill(data: {
    communityId: string;
    name: string;
    description: string;
    version: string;
    sourceCode: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    category?: string;
    tags?: string[];
  }): Promise<any> {
    return this.request("/v1/skills", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /** Install a skill (increment download count and get source) */
  async installSkill(id: string): Promise<any> {
    return this.request(`/v1/skills/${id}/install`, { method: "POST" });
  }
}

/** Create a configured client from stored config/env */
export function createClient(): ADKClient {
  const apiUrl = getApiUrl();
  const apiKey = getApiKey();
  return new ADKClient(apiUrl, apiKey);
}
