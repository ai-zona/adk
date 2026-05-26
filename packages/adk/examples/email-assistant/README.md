# Email Assistant

An agent that drafts emails using a structured tool with Zod validation.

## Run

```bash
ANTHROPIC_API_KEY=<your-key> npx tsx index.ts \
  "Draft a follow-up to sarah@example.com about last week's Q3 review"
```

## What it does

- Defines a `draft_email` tool with a rich Zod schema (email, enum, defaults)
- The agent parses the user's natural language request and calls the tool
- In a real app, the tool would call SendGrid / Gmail API / Nodemailer

## Key APIs

```ts
defineTool({
  name: "draft_email",
  inputSchema: z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
    tone: z.enum(["professional", "friendly", "formal"]).default("professional"),
  }),
  execute: async ({ to, subject, body, tone }) => { /* send or save */ },
})
```

## Extend it

- Add a `send_email` tool that actually delivers via your email provider
- Wire up Gmail API with OAuth using the ADK `ProxyRouter`
- Add a guardrail to require explicit confirmation before sending

See the [ADK README](../../README.md) for the full API reference.
