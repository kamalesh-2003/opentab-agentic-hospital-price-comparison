/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ask from "../ask.js";
import type * as hospitals from "../hospitals.js";
import type * as ingest from "../ingest.js";
import type * as ingestRun from "../ingestRun.js";
import type * as ingestRunQueries from "../ingestRunQueries.js";
import type * as lib_catalog from "../lib/catalog.js";
import type * as lib_claude from "../lib/claude.js";
import type * as lib_elastic from "../lib/elastic.js";
import type * as lib_indexer from "../lib/indexer.js";
import type * as searches from "../searches.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ask: typeof ask;
  hospitals: typeof hospitals;
  ingest: typeof ingest;
  ingestRun: typeof ingestRun;
  ingestRunQueries: typeof ingestRunQueries;
  "lib/catalog": typeof lib_catalog;
  "lib/claude": typeof lib_claude;
  "lib/elastic": typeof lib_elastic;
  "lib/indexer": typeof lib_indexer;
  searches: typeof searches;
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

export declare const components: {};
