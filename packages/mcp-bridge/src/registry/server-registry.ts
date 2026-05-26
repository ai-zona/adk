import { db } from "../db";
import type { RegisterServerInput, ServerFilters, ToolInfo } from "../types";
import { RegisterServerInputSchema } from "../types";

/**
 * The shape of an MCP server record as returned from the database.
 * We use the Prisma-inferred type directly.
 */
export type MCPServerRecord = Awaited<ReturnType<typeof db.mCPServer.findUniqueOrThrow>>;

/**
 * The shape of an MCP tool record as returned from the database.
 */
export type MCPToolRecord = Awaited<ReturnType<typeof db.mCPTool.findUniqueOrThrow>>;

/**
 * Prisma where-input type for MCPServer, inferred from the db client.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MCPServerWhereInput = any;

/**
 * Checks if a URL points to an internal/private network address.
 * Used to prevent SSRF attacks by blocking registration of servers
 * that resolve to localhost, private IP ranges, or cloud metadata endpoints.
 */
function isInternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "0.0.0.0"
    )
      return true;
    if (hostname.endsWith(".internal") || hostname.endsWith(".local")) return true;
    // Block private IP ranges
    const parts = hostname.split(".").map(Number);
    const p0 = parts[0] ?? -1;
    const p1 = parts[1] ?? -1;
    if (p0 === 10) return true;
    if (p0 === 172 && p1 >= 16 && p1 <= 31) return true;
    if (p0 === 192 && p1 === 168) return true;
    if (hostname === "169.254.169.254") return true; // AWS metadata
    return false;
  } catch {
    return true; // Invalid URLs are blocked
  }
}

/**
 * ServerRegistry provides database-backed CRUD operations for MCP servers
 * and their associated tools. It handles server registration, updates,
 * removal, and tool synchronization from live MCP server discovery.
 */
export class ServerRegistry {
  /**
   * Registers a new MCP server in the database.
   *
   * @param data - Server registration data
   * @returns The created server record
   * @throws If validation fails or the server already exists
   */
  async registerServer(data: RegisterServerInput): Promise<MCPServerRecord> {
    const validated = RegisterServerInputSchema.parse(data);

    // SSRF protection: block internal/private network URLs
    if (validated.url && isInternalUrl(validated.url)) {
      throw new Error(`Cannot register server with internal URL: ${validated.url}`);
    }

    return db.mCPServer.create({
      data: {
        name: validated.name,
        description: validated.description,
        url: validated.url,
        transport: validated.transport,
        authType: validated.authType,
        registeredByAgentId: validated.registeredByAgentId,
        registeredByUserId: validated.registeredByUserId,
        healthCheckUrl: validated.healthCheckUrl,
        version: validated.version,
        documentationUrl: validated.documentationUrl,
        iconUrl: validated.iconUrl,
      },
    });
  }

  /**
   * Updates an existing MCP server's configuration.
   *
   * @param id - The server ID to update
   * @param data - Partial update data
   * @returns The updated server record
   * @throws If the server does not exist
   */
  async updateServer(id: string, data: Partial<RegisterServerInput>): Promise<MCPServerRecord> {
    // SSRF protection: block internal/private network URLs on update as well
    if (data.url && isInternalUrl(data.url)) {
      throw new Error(`Cannot register server with internal URL: ${data.url}`);
    }

    return db.mCPServer.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.url !== undefined && { url: data.url }),
        ...(data.transport !== undefined && { transport: data.transport }),
        ...(data.authType !== undefined && { authType: data.authType }),
        ...(data.registeredByAgentId !== undefined && {
          registeredByAgentId: data.registeredByAgentId,
        }),
        ...(data.registeredByUserId !== undefined && {
          registeredByUserId: data.registeredByUserId,
        }),
        ...(data.healthCheckUrl !== undefined && {
          healthCheckUrl: data.healthCheckUrl,
        }),
        ...(data.version !== undefined && { version: data.version }),
        ...(data.documentationUrl !== undefined && {
          documentationUrl: data.documentationUrl,
        }),
        ...(data.iconUrl !== undefined && { iconUrl: data.iconUrl }),
      },
    });
  }

  /**
   * Removes an MCP server and all its associated tools (cascading delete).
   *
   * @param id - The server ID to remove
   */
  async removeServer(id: string): Promise<void> {
    await db.mCPServer.delete({
      where: { id },
    });
  }

  /**
   * Retrieves a single MCP server by ID, including its tools.
   *
   * @param id - The server ID to look up
   * @returns The server record with tools, or null if not found
   */
  async getServer(id: string): Promise<MCPServerRecord | null> {
    return db.mCPServer.findUnique({
      where: { id },
      include: { tools: true },
    });
  }

  /**
   * Lists MCP servers with optional filtering and pagination.
   *
   * @param filters - Optional filter criteria
   * @returns Paginated list of servers and total count
   */
  async listServers(
    filters?: ServerFilters,
  ): Promise<{ servers: MCPServerRecord[]; total: number }> {
    const where: MCPServerWhereInput = {};

    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.transport) {
      where.transport = filters.transport;
    }
    if (filters?.registeredByAgentId) {
      where.registeredByAgentId = filters.registeredByAgentId;
    }
    if (filters?.registeredByUserId) {
      where.registeredByUserId = filters.registeredByUserId;
    }
    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" as const } },
        { description: { contains: filters.search, mode: "insensitive" as const } },
      ];
    }

    const [servers, total] = await Promise.all([
      db.mCPServer.findMany({
        where,
        include: { tools: true },
        skip: filters?.skip ?? 0,
        take: filters?.take ?? 50,
        orderBy: { createdAt: "desc" },
      }),
      db.mCPServer.count({ where }),
    ]);

    return { servers, total };
  }

  /**
   * Synchronizes discovered tools from a live MCP server with the database.
   *
   * This performs an upsert for each discovered tool and marks tools
   * not present in the discovery as deprecated. New tools are created,
   * existing tools have their schemas updated.
   *
   * @param serverId - The server ID whose tools to sync
   * @param tools - Tools discovered from the MCP server
   */
  async syncTools(serverId: string, tools: ToolInfo[]): Promise<void> {
    // Get existing tools for this server
    const existingTools = await db.mCPTool.findMany({
      where: { serverId },
      select: { id: true, name: true },
    });

    const existingByName = new Map(existingTools.map((t: any) => [t.name, t.id]));
    const discoveredNames = new Set(tools.map((t) => t.name));

    // Upsert each discovered tool
    const upsertPromises = tools.map((tool) => {
      const existingId = existingByName.get(tool.name);

      if (existingId) {
        // Update existing tool
        return db.mCPTool.update({
          where: { id: existingId },
          data: {
            description: tool.description ?? "",
            inputSchema: tool.inputSchema as unknown as Record<string, never>,
            outputSchema: tool.outputSchema
              ? (tool.outputSchema as unknown as Record<string, never>)
              : undefined,
            deprecated: false,
          },
        });
      }

      // Create new tool
      return db.mCPTool.create({
        data: {
          serverId,
          name: tool.name,
          description: tool.description ?? "",
          inputSchema: tool.inputSchema as unknown as Record<string, never>,
          outputSchema: tool.outputSchema
            ? (tool.outputSchema as unknown as Record<string, never>)
            : undefined,
        },
      });
    });

    // Mark tools not found in discovery as deprecated
    const deprecatePromises = existingTools
      .filter((t: any) => !discoveredNames.has(t.name))
      .map((t: any) =>
        db.mCPTool.update({
          where: { id: t.id },
          data: { deprecated: true },
        }),
      );

    await Promise.all([...upsertPromises, ...deprecatePromises]);
  }
}
