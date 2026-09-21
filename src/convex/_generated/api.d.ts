/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adviser from "../adviser.js";
import type * as agentDef from "../agentDef.js";
import type * as answerLedger from "../answerLedger.js";
import type * as applicationDrafts from "../applicationDrafts.js";
import type * as assistant from "../assistant.js";
import type * as assistantRouter from "../assistantRouter.js";
import type * as auth from "../auth.js";
import type * as backboneAgent from "../backboneAgent.js";
import type * as backboneAgentActions from "../backboneAgentActions.js";
import type * as catalogPolicy from "../catalogPolicy.js";
import type * as countryPacks from "../countryPacks.js";
import type * as crons from "../crons.js";
import type * as curation from "../curation.js";
import type * as dataControls from "../dataControls.js";
import type * as entityLinks from "../entityLinks.js";
import type * as entityResolutionPolicy from "../entityResolutionPolicy.js";
import type * as evidencePolicy from "../evidencePolicy.js";
import type * as finalReview from "../finalReview.js";
import type * as groundingPolicy from "../groundingPolicy.js";
import type * as guideMatchPolicy from "../guideMatchPolicy.js";
import type * as http from "../http.js";
import type * as identity from "../identity.js";
import type * as importDrafts from "../importDrafts.js";
import type * as linkIntake from "../linkIntake.js";
import type * as opportunities from "../opportunities.js";
import type * as planOutcomes from "../planOutcomes.js";
import type * as planUpdates from "../planUpdates.js";
import type * as profileInterpretation from "../profileInterpretation.js";
import type * as profiles from "../profiles.js";
import type * as providerInsights from "../providerInsights.js";
import type * as providers from "../providers.js";
import type * as rankingActions from "../rankingActions.js";
import type * as rankingPolicy from "../rankingPolicy.js";
import type * as readinessPlanPolicy from "../readinessPlanPolicy.js";
import type * as readinessPolicy from "../readinessPolicy.js";
import type * as reminders from "../reminders.js";
import type * as reportPolicy from "../reportPolicy.js";
import type * as safetyPolicy from "../safetyPolicy.js";
import type * as seed from "../seed.js";
import type * as seedCatalog from "../seedCatalog.js";
import type * as sourceMonitor from "../sourceMonitor.js";
import type * as successStories from "../successStories.js";
import type * as track from "../track.js";
import type * as userDocuments from "../userDocuments.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adviser: typeof adviser;
  agentDef: typeof agentDef;
  answerLedger: typeof answerLedger;
  applicationDrafts: typeof applicationDrafts;
  assistant: typeof assistant;
  assistantRouter: typeof assistantRouter;
  auth: typeof auth;
  backboneAgent: typeof backboneAgent;
  backboneAgentActions: typeof backboneAgentActions;
  catalogPolicy: typeof catalogPolicy;
  countryPacks: typeof countryPacks;
  crons: typeof crons;
  curation: typeof curation;
  dataControls: typeof dataControls;
  entityLinks: typeof entityLinks;
  entityResolutionPolicy: typeof entityResolutionPolicy;
  evidencePolicy: typeof evidencePolicy;
  finalReview: typeof finalReview;
  groundingPolicy: typeof groundingPolicy;
  guideMatchPolicy: typeof guideMatchPolicy;
  http: typeof http;
  identity: typeof identity;
  importDrafts: typeof importDrafts;
  linkIntake: typeof linkIntake;
  opportunities: typeof opportunities;
  planOutcomes: typeof planOutcomes;
  planUpdates: typeof planUpdates;
  profileInterpretation: typeof profileInterpretation;
  profiles: typeof profiles;
  providerInsights: typeof providerInsights;
  providers: typeof providers;
  rankingActions: typeof rankingActions;
  rankingPolicy: typeof rankingPolicy;
  readinessPlanPolicy: typeof readinessPlanPolicy;
  readinessPolicy: typeof readinessPolicy;
  reminders: typeof reminders;
  reportPolicy: typeof reportPolicy;
  safetyPolicy: typeof safetyPolicy;
  seed: typeof seed;
  seedCatalog: typeof seedCatalog;
  sourceMonitor: typeof sourceMonitor;
  successStories: typeof successStories;
  track: typeof track;
  userDocuments: typeof userDocuments;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
};
