---
name: Feature Request
about: Suggest a new feature or improvement for the ADK
title: "[feat] "
labels: ["enhancement", "needs-triage"]
assignees: []
---

## Summary

<!-- One sentence: what do you want and why? -->

## Problem / Motivation

<!-- What problem are you trying to solve? What workaround are you currently using (if any)? -->

## Proposed Solution

<!-- Describe the feature as concretely as you can. Include API sketches if relevant. -->

```typescript
// Example of what the new API might look like
import { defineAgent } from "@aizona/adk";

const agent = defineAgent({
  // ...new option here
});
```

## Alternatives Considered

<!-- What other approaches did you consider? Why is this one better? -->

## Scope

<!-- Which package would this live in? -->
- [ ] `@aizona/adk` — core SDK
- [ ] `@aizona/adk-cli` — CLI
- [ ] `@aizona/adk-server` — REST/SSE server
- [ ] `@aizona/aza-protocol` — agent identity / trust
- [ ] `@aizona/mcp-bridge` — MCP integration
- [ ] New package
- [ ] Other / unsure

## Impact

<!-- How many users / use-cases does this unblock? Is it blocking you from using the ADK? -->

- [ ] Blocking my use case
- [ ] Nice to have
- [ ] Minor improvement / DX polish

## Willing to Contribute?

- [ ] Yes, I'd like to open a PR for this
- [ ] I can help review a PR
- [ ] I'm just suggesting — happy for someone else to implement

## Additional Context

<!-- Links to related issues, art of the possible, prior art in other SDKs, etc. -->
