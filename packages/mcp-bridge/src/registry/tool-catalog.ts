import { db } from "@aizona/db";
import type { ToolSearchQuery } from "../types";

/**
 * The shape of a tool record as returned from catalog queries.
 * Includes the parent server relationship.
 */
export type ToolRecord = Awaited<ReturnType<typeof db.mCPTool.findUniqueOrThrow>> & {
  server?: {
    id: string;
    name: string;
    url: string;
    status: string;
  };
};

/**
 * Prisma where-input type for MCPTool, inferred from the db client.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MCPToolWhereInput = any;

/**
 * ToolCatalog provides read-only search and discovery operations
 * for MCP tools registered in the database. Supports full-text search,
 * filtering by category/tags/pricing, and agent-scoped access.
 */
export class ToolCatalog {
  /**
   * Searches for tools with flexible query parameters.
   *
   * @param query - Search criteria including text query, filters, and pagination
   * @returns Paginated list of matching tools and total count
   */
  async searchTools(query: ToolSearchQuery): Promise<{ tools: ToolRecord[]; total: number }> {
    const where: MCPToolWhereInput = {};

    // Text search across name and description
    if (query.query) {
      where.OR = [
        { name: { contains: query.query, mode: "insensitive" as const } },
        { description: { contains: query.query, mode: "insensitive" as const } },
      ];
    }

    if (query.category) {
      where.category = query.category;
    }

    if (query.tags && query.tags.length > 0) {
      where.tags = { hasSome: query.tags };
    }

    if (query.pricingModel) {
      where.pricingModel = query.pricingModel;
    }

    if (query.serverId) {
      where.serverId = query.serverId;
    }

    if (query.deprecated !== undefined) {
      where.deprecated = query.deprecated;
    } else {
      // By default, exclude deprecated tools
      where.deprecated = false;
    }

    const [tools, total] = await Promise.all([
      db.mCPTool.findMany({
        where,
        include: {
          server: {
            select: {
              id: true,
              name: true,
              url: true,
              status: true,
            },
          },
        },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        orderBy: { createdAt: "desc" },
      }),
      db.mCPTool.count({ where }),
    ]);

    return { tools: tools as ToolRecord[], total };
  }

  /**
   * Retrieves a single tool by its database ID.
   *
   * @param id - The tool's database ID
   * @returns The tool record with server info, or null if not found
   */
  async getToolById(id: string): Promise<ToolRecord | null> {
    const tool = await db.mCPTool.findUnique({
      where: { id },
      include: {
        server: {
          select: {
            id: true,
            name: true,
            url: true,
            status: true,
          },
        },
      },
    });

    return tool as ToolRecord | null;
  }

  /**
   * Retrieves a tool by its server ID and tool name (the unique constraint).
   *
   * @param serverId - The server's database ID
   * @param name - The tool's name on the server
   * @returns The tool record, or null if not found
   */
  async getToolByServerAndName(serverId: string, name: string): Promise<ToolRecord | null> {
    const tool = await db.mCPTool.findUnique({
      where: {
        serverId_name: { serverId, name },
      },
      include: {
        server: {
          select: {
            id: true,
            name: true,
            url: true,
            status: true,
          },
        },
      },
    });

    return tool as ToolRecord | null;
  }

  /**
   * Retrieves all non-deprecated tools in a given category.
   *
   * @param category - The category to filter by
   * @returns Array of matching tool records
   */
  async getToolsByCategory(category: string): Promise<ToolRecord[]> {
    const tools = await db.mCPTool.findMany({
      where: {
        category,
        deprecated: false,
      },
      include: {
        server: {
          select: {
            id: true,
            name: true,
            url: true,
            status: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    return tools as ToolRecord[];
  }

  /**
   * Retrieves all non-deprecated tools matching any of the given tags.
   *
   * @param tags - Tags to match against
   * @returns Array of matching tool records
   */
  async getToolsByTags(tags: string[]): Promise<ToolRecord[]> {
    const tools = await db.mCPTool.findMany({
      where: {
        tags: { hasSome: tags },
        deprecated: false,
      },
      include: {
        server: {
          select: {
            id: true,
            name: true,
            url: true,
            status: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    return tools as ToolRecord[];
  }

  /**
   * Retrieves all tools that an agent has active skill grants for.
   * Only returns tools from active, non-expired grants.
   *
   * @param agentId - The agent's ID (DID or database ID)
   * @returns Array of tools the agent is authorized to use
   */
  async getToolsForAgent(agentId: string): Promise<ToolRecord[]> {
    const grants = await db.mCPSkillGrant.findMany({
      where: {
        agentId,
        active: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: {
        toolId: true,
      },
    });

    if (grants.length === 0) {
      return [];
    }

    const toolIds = grants.map((g: any) => g.toolId);

    const tools = await db.mCPTool.findMany({
      where: {
        id: { in: toolIds },
        deprecated: false,
      },
      include: {
        server: {
          select: {
            id: true,
            name: true,
            url: true,
            status: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    return tools as ToolRecord[];
  }
}
