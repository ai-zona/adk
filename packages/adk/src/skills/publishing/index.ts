// ──────────────────────────────────────────────────────
// Publishing Skills — Barrel (skills 1-12)
// ──────────────────────────────────────────────────────

// Shared types
export * from "./types";

// ─── Skills 1-6 (H-1 stream — subdirectory layout) ───
export { manuscriptIngestManifest } from "./manuscript-ingest/manifest";
export { executeManuscriptIngest } from "./manuscript-ingest/execute";
export type {
  ManuscriptIngestInput,
  ManuscriptIngestOutput,
  ManuscriptChapter,
  Parsers as ManuscriptParsers,
} from "./manuscript-ingest/execute";
export { manuscriptSummarizeManifest } from "./manuscript-summarize/manifest";
export { executeManuscriptSummarize } from "./manuscript-summarize/execute";
export type {
  ManuscriptSummarizeInput,
  ManuscriptSummarizeOutput,
} from "./manuscript-summarize/execute";
export { bookEditSuggestManifest } from "./book-edit-suggest/manifest";
export { executeBookEditSuggest } from "./book-edit-suggest/execute";
export type {
  BookEditSuggestInput,
  EditSuggestion,
} from "./book-edit-suggest/execute";
export { publisherDatabaseSearchManifest } from "./publisher-database-search/manifest";
export { executePublisherDatabaseSearch } from "./publisher-database-search/execute";
export type {
  PublisherSearchInput,
  PublisherSearchResult,
} from "./publisher-database-search/execute";
export { marketFitScoreManifest } from "./market-fit-score/manifest";
export { executeMarketFitScore } from "./market-fit-score/execute";
export type { MarketFitInput, MarketFitOutput } from "./market-fit-score/execute";
export { queryLetterGenerateManifest } from "./query-letter-generate/manifest";
export { executeQueryLetterGenerate } from "./query-letter-generate/execute";
export type {
  QueryLetterInput,
  QueryLetterOutput,
} from "./query-letter-generate/execute";

// ─── Skills 7-12 (H-2 stream — flat-file layout) ───

// Skill 7
export { queryLetterPersonalize, queryLetterPersonalizeManifest } from "./query-letter-personalize";
export type {
  QueryLetterPersonalizeInput,
  QueryLetterPersonalizeOutput,
  QueryLetterPersonalizeContext,
  AcquisitionRecord,
} from "./query-letter-personalize";

// Skill 8
export { emailCampaignBasic, emailCampaignBasicManifest } from "./email-campaign-basic";
export type {
  EmailContact,
  EmailTemplate,
  EmailCampaignBasicInput,
  EmailCampaignBasicOutput,
  EmailCampaignBasicContext,
  DeliveryReportRow,
} from "./email-campaign-basic";

// Skill 9
export { emailCampaignAdvanced, emailCampaignAdvancedManifest } from "./email-campaign-advanced";
export type {
  EmailCampaignAdvancedInput,
  EmailCampaignAdvancedOutput,
  EmailCampaignAdvancedContext,
  CampaignVariant,
} from "./email-campaign-advanced";

// Skill 10
export { authorBioGenerate, authorBioGenerateManifest } from "./author-bio-generate";
export type {
  AuthorBioGenerateInput,
  AuthorBioGenerateOutput,
  AuthorBioGenerateContext,
} from "./author-bio-generate";

// Skill 11
export { compTitleFinder, compTitleFinderManifest } from "./comp-title-finder";
export type {
  CompTitleFinderInput,
  CompTitleFinderOutput,
  CompTitleFinderContext,
  CompTitle,
} from "./comp-title-finder";

// Skill 12
export { submissionTracker, submissionTrackerManifest } from "./submission-tracker";
export type {
  SubmissionTrackerInput,
  SubmissionTrackerOutput,
  SubmissionTrackerContext,
  SubmissionStatus,
  SubmissionTimelineEntry,
  SubmissionRecord,
} from "./submission-tracker";

// Aggregated manifest list (H-1 skills 1-6)
import { bookEditSuggestManifest } from "./book-edit-suggest/manifest";
import { manuscriptIngestManifest } from "./manuscript-ingest/manifest";
import { manuscriptSummarizeManifest } from "./manuscript-summarize/manifest";
import { marketFitScoreManifest } from "./market-fit-score/manifest";
import { publisherDatabaseSearchManifest } from "./publisher-database-search/manifest";
import { queryLetterGenerateManifest } from "./query-letter-generate/manifest";

export const PUBLISHING_SKILL_MANIFESTS = [
  manuscriptIngestManifest,
  manuscriptSummarizeManifest,
  bookEditSuggestManifest,
  publisherDatabaseSearchManifest,
  marketFitScoreManifest,
  queryLetterGenerateManifest,
];
