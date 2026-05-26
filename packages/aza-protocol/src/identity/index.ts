// ──────────────────────────────────────────────────────
// AZA Protocol Identity Module
// ──────────────────────────────────────────────────────

// Keypair generation and hex conversion
export {
  initSyncHash,
  generateKeypair,
  generateKeypairSync,
  publicKeyFromPrivateKey,
  publicKeyFromPrivateKeySync,
  publicKeyToHex,
  privateKeyToHex,
  publicKeyFromHex,
  privateKeyFromHex,
  keypairToHex,
  keypairFromHex,
  KeyPairHexSchema,
} from "./keypair";

export type { KeyPair, KeyPairHex } from "./keypair";

// DID creation and validation
export {
  AZA_DID_METHOD,
  AZANetwork,
  AZANetworkSchema,
  AZADIDSchema,
  createDID,
  createDIDFromHex,
  parseDID,
  validateDID,
  ParsedDIDSchema,
} from "./did";

export type { AZANetwork as AZANetworkType, AZADID, ParsedDID } from "./did";

// Message signing and verification
export {
  signMessage,
  signMessageSync,
  verifySignature,
  verifySignatureSync,
  isValidSignature,
  isValidSignatureSync,
} from "./signing";

// Agent Card
export {
  AgentSkillSchema,
  AgentEndpointSchema,
  AgentCardDataSchema,
  AgentCardSchema,
  signAgentCard,
  verifyAgentCard,
  createAgentCardData,
} from "./agent-card";

export type {
  AgentSkill,
  AgentEndpoint,
  AgentCardData,
  AgentCard,
} from "./agent-card";

// DID Resolver
export {
  DIDDocumentSchema,
  DIDResolver,
} from "./did-resolver";

export type {
  DIDDocument,
  DIDResolverConfig,
} from "./did-resolver";
