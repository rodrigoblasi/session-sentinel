# ADR-0003: OpenAPI Spec Strategy

**Status:** Decided — Option C (Static spec now, Fastify schemas as follow-up)
**Date:** 2026-03-29
**Author:** Claude (with rodrigoblasi)
**Issue:** #28 (Phase 2 — OpenAPI spec + formal API docs)
**Relates to:** Design spec §12 (Documentation Deliverables — OpenAPI Spec)

---

## 1. Context

The design spec (§12) defines the last Phase 2 deliverable:

> Formal API specification published at `GET /docs`:
> - Typed request/response schemas
> - Inline examples
> - Field descriptions
> - Can become MCP tool spec in the future

The agent-guide.md already documents all 12 endpoints with curl examples, query parameters, request bodies, and response shapes. What's missing is a **machine-readable, formally typed** OpenAPI spec.

### Current state of route definitions

All 12 route handlers in `src/api/routes.ts` use manual casting for request parameters:

```typescript
// Every route does this:
const query = request.query as Record<string, string>;
const { id } = request.params as { id: string };
const body = request.body as Record<string, unknown>;
```

No Fastify JSON Schema is defined on any route. There is no request validation — invalid query parameters are silently ignored, and missing body fields are caught by manual `if (!body.prompt)` checks.

### Current stack

- Fastify 5 (supports JSON Schema route schemas natively)
- No `@fastify/swagger` or `@fastify/swagger-ui` installed
- TypeScript types for all request/response shapes exist in `src/shared/types.ts`
- 150 tests passing, test coverage is solid

---

## 2. The Problem

How to produce and serve the OpenAPI spec. The tension is between two goals:

1. **Close Phase 2 quickly** — the spec says "published at GET /docs", all the information exists, we just need to formalize it.
2. **Keep the spec in sync with code** — a static spec file will drift from route changes over time. Auto-generated specs from Fastify schemas stay in sync by construction.

A secondary decision: should this task also add **request validation** to all routes (by adding JSON Schema to Fastify handlers), or is that a separate concern?

---

## 3. Options

### Option A: Static OpenAPI YAML, served as-is

Write an `openapi.yaml` file manually, based on the existing TypeScript types and agent-guide.md. Serve it at `GET /docs/openapi.json` (rendered from YAML at startup). Optionally serve Swagger UI at `GET /docs` using `@fastify/swagger-ui` pointed at the static spec.

```
docs/openapi.yaml   ← handwritten, source of truth
  ↓ loaded at startup
GET /docs            ← Swagger UI (optional)
GET /docs/openapi.json  ← raw spec for programmatic consumers
```

**Implementation:**
- Write `docs/openapi.yaml` (~300-400 lines for 12 endpoints)
- Add route in `server.ts` to serve the spec
- Optionally install `@fastify/swagger-ui` to render it
- Routes stay exactly as-is — no refactor

**Pros:**
- Minimal code changes — one new file, one new route
- Full control over spec quality (descriptions, examples, field docs)
- No coupling between spec and Fastify internals
- agent-guide.md is the reference — translating to OpenAPI is straightforward
- Closes Phase 2 fast

**Cons:**
- **Drift risk** — spec and routes can diverge when endpoints change. No compile-time or test-time guard.
- Manual maintenance burden — every route change requires updating both code and YAML
- Duplicates what's already in agent-guide.md (but in a different format)
- No request validation added — routes still use `as Record<string, string>`

**Risk level:** Low implementation risk. Medium maintenance risk (drift).

### Option B: Fastify JSON Schema on all routes + @fastify/swagger auto-generation

Add JSON Schema definitions to every Fastify route handler (querystring, params, body, response). Install `@fastify/swagger` to auto-generate the OpenAPI spec from those schemas, and `@fastify/swagger-ui` to serve it.

```
src/api/routes.ts   ← schemas defined inline per route
  ↓ Fastify registers schemas
@fastify/swagger    ← auto-generates OpenAPI spec
  ↓
GET /docs            ← Swagger UI
GET /docs/openapi.json  ← generated spec
```

**Implementation:**
- Install `@fastify/swagger` + `@fastify/swagger-ui`
- Define JSON Schema for all 12 routes (querystring, params, body, response)
- Refactor handlers to use Fastify's typed request generics instead of `as Record<...>`
- Register swagger plugin in `server.ts`
- Routes gain automatic request validation as a side effect

**Example refactor (one route):**

```typescript
// Before:
app.get('/sessions', async (request) => {
  const query = request.query as Record<string, string>;
  if (query.status) filters.status = query.status as any;
  // ...
});

// After:
app.get('/sessions', {
  schema: {
    querystring: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['starting','active','waiting','idle','ended','error'] },
        type: { type: 'string', enum: ['managed','unmanaged'] },
        owner: { type: 'string' },
        project: { type: 'string' },
        active: { type: 'string', enum: ['true'] },
        limit: { type: 'integer', minimum: 1 },
      },
    },
    response: {
      200: { type: 'array', items: { $ref: '#/components/schemas/Session' } },
    },
  },
}, async (request) => {
  const query = request.query as SessionFilters;
  // ...
});
```

**Pros:**
- **Spec stays in sync by construction** — generated from the code, never drifts
- Routes gain request validation for free (invalid query params → 400, missing body fields → 400)
- Type safety improves — Fastify infers request types from schemas
- Single source of truth: the schema IS the spec
- Better developer experience — Swagger UI with "Try it out" for interactive testing

**Cons:**
- **Touches all 12 route handlers** — significant refactor scope for a "docs" task
- JSON Schema is verbose — each route schema adds 20-50 lines
- Existing tests may need updates if validation behavior changes (e.g., unknown query params now rejected)
- Two new dependencies (`@fastify/swagger`, `@fastify/swagger-ui`)
- Risk of breaking existing agent integrations if validation is stricter than current behavior
- Mixes two concerns: documentation (Phase 2) and validation (not in spec)

**Risk level:** Medium. The refactor is well-understood but wide — all routes, all tests.

### Option C: Static spec now, Fastify schemas as follow-up

Write a static `openapi.yaml` (Option A) to close Phase 2, then create a follow-up issue for migrating to Fastify schemas + auto-generation (Option B).

```
Phase 2 (now):   openapi.yaml → GET /docs     ← closes Phase 2
Follow-up:       Fastify schemas → replaces static spec  ← separate issue
```

**Implementation:**
- Phase 2: same as Option A
- Follow-up issue: refactor routes to use JSON Schema, install @fastify/swagger, remove static YAML
- The follow-up naturally fits as a `type: refactor` issue

**Pros:**
- Closes Phase 2 with minimal scope — one deliverable, one issue
- Defers the refactor to when it's the primary concern (cleaner review, less risk)
- If the static spec proves sufficient (few route changes expected), the follow-up becomes optional
- Follows project principle: "issues focadas e incrementais"

**Cons:**
- Short-term drift window — between static spec and schema migration, spec could diverge
- Extra work if both phases happen close together (write YAML, then throw it away)
- Follow-up issue might get deprioritized indefinitely

**Risk level:** Low. Worst case is a short period of manual spec maintenance.

---

## 4. Comparison Matrix

| Criterion | A: Static YAML | B: Fastify schemas + swagger | C: Static now, schemas later |
|-----------|:-:|:-:|:-:|
| Closes Phase 2 | Yes | Yes | Yes |
| Spec-code sync guarantee | No (manual) | Yes (generated) | No → Yes (after follow-up) |
| Implementation scope | Small (1 file + 1 route) | Large (12 routes refactored) | Small now, large later |
| Request validation | No change | Gained for free | No change → gained later |
| New dependencies | 0-1 | 2 | 0-1 → 2 |
| Risk of breaking existing behavior | None | Medium (stricter validation) | None → Medium |
| Maintenance burden | Medium (manual sync) | Low (auto-generated) | Medium → Low |
| Aligns with "incremental issues" | Yes | Bundles docs + refactor | Yes |

---

## 5. Recommendation

**Option C: Static spec now, Fastify schemas as follow-up.**

Rationale:
1. Phase 2's deliverable is "formal API spec published at GET /docs" — not "refactored routes with validation." Option C delivers exactly what the spec asks for, nothing more.
2. The project's pattern is incremental, focused issues. Bundling a 12-route refactor into a docs task violates this — ADR-0002 was scoped to hierarchy only, not "hierarchy + query optimization." Same principle applies here.
3. The static spec serves the immediate consumers (agents reading the API) identically to an auto-generated one. The difference only matters for long-term maintenance.
4. If route changes are infrequent (Sentinel's API is relatively stable post-Phase 2), the drift risk of a static spec is low. If routes change often, the follow-up issue moves up in priority naturally.
5. The follow-up refactor (Fastify schemas) is independently valuable — it adds request validation, improves type safety, and replaces the static spec. It doesn't need to be part of Phase 2 to justify itself.

### Sub-decision: Swagger UI

Recommend including Swagger UI via `@fastify/swagger-ui` even with Option C. The package works with static spec files — it just needs a URL to the spec JSON. This gives interactive exploration at `GET /docs` while the raw spec is at `GET /docs/openapi.json`. One lightweight dependency, high value.

---

## 6. Decision

> **Status: DECIDED** — 2026-03-29

**Chosen option:** Option C — Static OpenAPI YAML now, Fastify route schemas as a follow-up issue.

**Sub-decision:** Include `@fastify/swagger-ui` with the static spec to serve an interactive `GET /docs` endpoint. Low dependency cost, high value for development and exploration.

**Reasoning:**
1. Phase 2's deliverable is "formal API spec published at GET /docs" — not "refactored routes with validation." Option C delivers exactly what the spec requires without scope creep.
2. Option B mixes two concerns: documentation (Phase 2) and request validation (not in Phase 2 spec). Bundling them risks regression — agents currently passing extra params silently would receive 400s after schema enforcement. This is a behavioral change that deserves its own focused issue and testing.
3. The project's established pattern is incremental, focused issues (ADR-0001: V1 now, V2 later; ADR-0002: count in lists, full detail later). The same principle applies here.
4. The Fastify schema migration is independently valuable and can be prioritized on its own merits when the time is right.
5. Route drift risk is low — Sentinel's API is relatively stable post-Phase 2. If endpoints change, the follow-up issue moves up naturally.

---

## 7. Consequences (per option)

### If Option A is chosen
- `docs/openapi.yaml` becomes the spec source of truth
- New route in `server.ts` to serve the spec
- agent-guide.md and openapi.yaml must be kept in sync manually
- No route behavior changes, no test changes

### If Option B is chosen
- All 12 route handlers gain JSON Schema definitions
- `@fastify/swagger` + `@fastify/swagger-ui` installed
- Request validation enabled across all endpoints — agents sending invalid params will get 400 instead of silent ignore
- Existing tests may need updates for new validation behavior
- `docs/openapi.yaml` is not needed — spec is auto-generated

### If Option C is chosen
- Same as Option A for Phase 2
- Follow-up issue created: `chore/N-fastify-route-schemas` (type: refactor)
- Follow-up replaces static YAML with auto-generated spec, adds validation
- Short-term: two endpoints serve docs (static). Long-term: auto-generated.

---

## 8. References

- Design spec §12: `docs/specs/2026-03-27-session-sentinel-design.md` (OpenAPI spec deliverable)
- Agent guide: `docs/agent-guide.md` (informal API docs, source for spec content)
- Routes: `src/api/routes.ts` (12 endpoints, no JSON Schema currently)
- Types: `src/shared/types.ts` (Session, Run, SubAgent, HierarchyBlock, etc.)
- Server setup: `src/api/server.ts` (Fastify plugins)
- Fastify JSON Schema validation: https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
- @fastify/swagger: https://github.com/fastify/fastify-swagger
- @fastify/swagger-ui: https://github.com/fastify/fastify-swagger-ui
