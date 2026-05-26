// ──────────────────────────────────────────────────────
// AZA Protocol Communication Patterns
// ──────────────────────────────────────────────────────

export { FanOutPattern } from "./fan-out";
export type {
  AggregationStrategy,
  FanOutConfig,
  FanOutResult,
} from "./fan-out";

export { AggregationPattern } from "./aggregation";
export type {
  ExecutionMode,
  SubTaskDefinition,
  AggregationConfig,
  TaskResult,
  AggregationResult,
} from "./aggregation";

export { PubSubManager } from "./pubsub";
export type {
  ChannelRecord,
  SubscriptionRecord,
} from "./pubsub";
