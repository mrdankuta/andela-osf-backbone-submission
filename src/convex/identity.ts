import { internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { authComponent } from "./auth";

// Ownership for private profiles and readiness plans (issue #44).
//
// Authenticated reads/writes derive identity server-side from the auth
// session — the caller-supplied device key is ignored. Anonymous callers
// keep using their device key. Keys in the reserved `user:` namespace are
// never accepted from callers, so a guessed identifier cannot reach
// another person's records.

export const RESERVED_KEY_PREFIX = "user:";

type Identity =
  | { kind: "user"; id: string }
  | { kind: "device"; id: string; via: "override" | "context" };

let testOverride: { kind: "user" | "device"; id: string; email?: string } | undefined = undefined;

export async function currentIdentity(ctx: QueryCtx | MutationCtx): Promise<Identity> {
  if (process.env.VITEST && testOverride !== undefined) {
    return { ...testOverride, via: "override" as const };
  }
  try {
    const user = (await authComponent.getAuthUser(ctx)) as { _id?: unknown } | null;
    if (user && typeof user._id === "string" && user._id) {
      return { kind: "user", id: `${RESERVED_KEY_PREFIX}${user._id}` };
    }
  } catch {
    // No session (or session lookup failed): anonymous device caller.
    // This is the normal signed-out path, not a failure — auth-gated
    // features branch on ident.kind and raise their own errors.
    return { kind: "device", id: "", via: "context" as const };
  }
  return { kind: "device", id: "", via: "context" as const };
}

export async function effectiveOwnerKey(ctx: QueryCtx | MutationCtx, suppliedKey: string): Promise<string> {
  const ident = await currentIdentity(ctx);
  if (ident.kind === "user") return ident.id;
  if (ident.via === "override") return ident.id;
  if (suppliedKey.startsWith(RESERVED_KEY_PREFIX)) throw new Error("Invalid identifier.");
  return suppliedKey;
}

/** Test hook: simulate an authenticated user or a fixed device identity.
 *  Refused outside vitest. */
export const _setTestIdentity = internalMutation({
  args: {
    kind: v.optional(v.union(v.literal("user"), v.literal("device"))),
    id: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (_ctx, args) => {
    if (!process.env.VITEST) throw new Error("Test hook only.");
    testOverride = args.kind && args.id ? { kind: args.kind, id: args.id, email: args.email } : undefined;
    return true;
  },
});

/** Account email for provider matching: override in tests, session in prod. */
export async function currentAccountEmail(ctx: QueryCtx | MutationCtx): Promise<string | null> {
  if (process.env.VITEST && testOverride !== undefined) {
    return testOverride.kind === "user" ? (testOverride.email ?? null) : null;
  }
  try {
    const user = (await authComponent.getAuthUser(ctx)) as { email?: unknown } | null;
    return typeof user?.email === "string" ? user.email : null;
  } catch {
    return null;
  }
}
