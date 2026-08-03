# Help Matching — R2 (nearby feed)

Decisions 2/7/21/29/135 + round-8 135 (`AI/docs/decisions/VGR-plano.md`);
spec tasks 04/05 as amended. R2 ships the anonymous feed; help offers and
lifecycle come with R3.

## Route

`GET /app-feed?lat&lng&page&order` — deliberately UNAUTHENTICATED
(success criterion 2): viewing nearby reports never requires an account.
The viewer's position is used transiently for the query and never stored
(decision 110). Page size 20, `order` recency (default) or relevance.

## Dynamic radius (decisions 7/29 — `dynamic-radius.ts`)

Per case type, never a fixed global (criterion 8): `min(cap, base +
growth × ageHours)`. One TS table is the SINGLE source — the domain
function uses it directly and the repository compiles it into SQL derived
tables, so the two can never drift. The mandatory subject axis (140)
refines movement: missing×animal roams (3+4/h, cap 80), missing×child
escalates fastest (2+6/h, cap 100); assault stays at 2 km fixed;
kidnapping grows 40 km/h to a 300 km cap (`MAX_RADIUS_KM`, the bounding
box bound).

## Query (`help-matching.repository.ts`)

Bounding box on the (lat,lng) index + `ST_Distance_Sphere` exact filter
`HAVING distance <= radius`, radius computed in SQL from the compiled
strategy. Relevance = 0.6×(distance/radius) + 0.4×(age capped at 24 h) —
deterministic and documented (decision 21). SQL over `tb_report` is
spec-sanctioned (section 5: help-matching owns `listNearby`).

## Tier degradation (decisions 41/135 — the load-bearing part)

The EXACT position never leaves the API. Per tier (read through
`shared/risk/risk-tier`, promoted in R2 — the extraction task 32 flagged):

| tier | position grid | distance step | time bucket |
|---|---|---|---|
| low | 0.001° (~110 m) | 0.1 km | minute |
| medium | 0.005° (~550 m) | 0.5 km | 15 min |
| high | 0.01° (~1.1 km) | 1 km | hour |

Grid rounding is deterministic on purpose (random jitter averages out
under repeated reads); the served distance derives from the DEGRADED
point, or repeated queries from different viewpoints would trilaterate
the exact position back. No reporterId, no engagement data (41/60).

Migration 031 seeds a conscious tier for every category (assault/homicide/
kidnapping/trafficking/fugitive high; missing/robbery/illegal_commerce
medium; rest low) — the 'low' fallback for an unconfigured category means
street-level precision, and that must never happen by accident. INSERT
IGNORE never overwrites an admin's choice (decision 46). Free-tag reports
serve at 'medium'.

Taxonomy note: the category is `missing` (not the spec's
`missing_person`) — with the mandatory subject axis, what disappeared is
the subject (child/adult/animal). Taxonomy itself moved to
`shared/taxonomy` (second consumer).

## Tests

`dynamic-radius.spec` (task-04 acceptance: pet grows, violence fixed,
child > adult, caps), `help-matching.service.spec` (grid/step/bucket per
tier, never-exact assertion, anti-trilateration, pagination probe, tier
lookup per category), `help-matching.routes.spec` (anonymous 200, 422
fields, relevance/paging). 50 suites / 300 tests.
