/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as ask from "../ask.js";
import type * as hospitals from "../hospitals.js";
import type * as ingest from "../ingest.js";
import type * as ingestRun from "../ingestRun.js";
import type * as ingestRunQueries from "../ingestRunQueries.js";
import type * as lib_catalog from "../lib/catalog.js";
import type * as lib_claude from "../lib/claude.js";
import type * as lib_elastic from "../lib/elastic.js";
import type * as lib_geo from "../lib/geo.js";
import type * as lib_indexer from "../lib/indexer.js";
import type * as nearby from "../nearby.js";
import type * as nearbyScan from "../nearbyScan.js";
import type * as nearbyScanQueries from "../nearbyScanQueries.js";
import type * as searches from "../searches.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  ask: typeof ask;
  hospitals: typeof hospitals;
  ingest: typeof ingest;
  ingestRun: typeof ingestRun;
  ingestRunQueries: typeof ingestRunQueries;
  "lib/catalog": typeof lib_catalog;
  "lib/claude": typeof lib_claude;
  "lib/elastic": typeof lib_elastic;
  "lib/geo": typeof lib_geo;
  "lib/indexer": typeof lib_indexer;
  nearby: typeof nearby;
  nearbyScan: typeof nearbyScan;
  nearbyScanQueries: typeof nearbyScanQueries;
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
