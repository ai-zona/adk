import { z } from "zod";

const cuid = z.string().min(20).max(40);

const contentPart = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().min(1).max(20000) }),
  z.object({
    kind: z.literal("image"),
    url: z.string().url(),
    alt: z.string().optional(),
    mimeType: z.string().optional(),
  }),
  z.object({
    kind: z.literal("audio"),
    url: z.string().url(),
    mimeType: z.string().optional(),
    durationSeconds: z.number().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("video"),
    url: z.string().url(),
    mimeType: z.string().optional(),
    durationSeconds: z.number().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("ui-artifact"),
    artifactId: z.string(),
    preview: z.string().optional(),
  }),
]);

export const listChannelsInputSchema = z.object({ workspaceId: cuid });
export const listChannelsOutputSchema = z.object({
  channels: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.enum(["GENERAL", "RECIPE", "DM", "SYSTEM"]),
      agentParticipants: z.array(z.string()),
      unreadCount: z.number().int().nonnegative(),
      archivedAt: z.string().datetime({ offset: true }).nullable(),
    }),
  ),
});

export const createChannelInputSchema = z.object({
  workspaceId: cuid,
  name: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9_-]*$/),
  kind: z.enum(["GENERAL", "RECIPE", "DM", "SYSTEM"]).default("GENERAL"),
  agentParticipants: z.array(z.string()).default([]),
});
export const createChannelOutputSchema = z.object({ channelId: z.string() });

export const sendMessageInputSchema = z.object({
  channelId: z.string(),
  content: z.object({ parts: z.array(contentPart).min(1) }),
  inReplyToId: z.string().optional(),
});
export const sendMessageOutputSchema = z.object({
  message: z.object({
    id: z.string(),
    channelId: z.string(),
    authorType: z.enum(["USER", "AGENT", "SYSTEM"]),
    authorId: z.string(),
    content: z.object({ parts: z.array(contentPart) }),
    createdAt: z.string().datetime({ offset: true }),
  }),
});

export const editMessageInputSchema = z.object({
  messageId: z.string(),
  content: z.object({ parts: z.array(contentPart).min(1) }),
});
export const editMessageOutputSchema = z.object({
  ok: z.boolean(),
  editedAt: z.string().datetime({ offset: true }),
});

export const listMessagesInputSchema = z.object({
  channelId: z.string(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export const listMessagesOutputSchema = z.object({
  messages: z.array(z.unknown()), // shape mirrors WorkspaceMessageWire
  nextCursor: z.string().optional(),
});

/** Subscribe returns a short-lived JWT used to authenticate /ws/workspace/[id] */
export const subscribeInputSchema = z.object({ workspaceId: cuid });
export const subscribeOutputSchema = z.object({
  wsJwt: z.string(),
  wsUrl: z.string().url(),
  expiresAt: z.string().datetime({ offset: true }),
});

export const workspaceChannelProcedures = {
  listChannels: { input: listChannelsInputSchema, output: listChannelsOutputSchema },
  createChannel: { input: createChannelInputSchema, output: createChannelOutputSchema },
  sendMessage: { input: sendMessageInputSchema, output: sendMessageOutputSchema },
  editMessage: { input: editMessageInputSchema, output: editMessageOutputSchema },
  listMessages: { input: listMessagesInputSchema, output: listMessagesOutputSchema },
  subscribe: { input: subscribeInputSchema, output: subscribeOutputSchema },
} as const;
