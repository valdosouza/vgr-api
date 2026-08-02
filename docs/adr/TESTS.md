# Testing Protocol

## OVERVIEW
TDD is mandatory (RED → GREEN → REFACTOR) via Jest + ts-jest. `supertest`
for HTTP route tests. No business rule without a test written first.

## COMMANDS
| Type | Command | Description |
|------|---------|-------------|
| All | `npm test` | Runs the full suite (`jest --runInBand --forceExit`) |
| Single file | `npm test -- specific.test` | Runs one specific test file |
| By name | `npm test -- --testNamePattern="pattern"` | Runs tests matching the pattern |
| Typecheck | `npx tsc --noEmit` | Type-checks without emitting |
| Coverage | `npm test -- --coverage` | Generates a coverage report |

## MINIMUM COVERAGE
REQUIRED: Maintain the following minimum coverage levels:

| Layer | Coverage | Description |
|-------|----------|-------------|
| service (business rules) | 90% | 404/409/validation cases and domain-specific rules |
| repository | 70% | Queries — prioritize non-trivial filters and joins |
| controller/routes | 60% | Via `supertest`, covering status codes and the error envelope |
| Global | 75% | Total project average |

⚠️ Initial proposal — no CI configured yet. Adjust after the first TDD
cycles via `harness-tracer`/`harness-evaluator`.

## PATTERNS & BEST PRACTICES
REQUIRED: AAA (Arrange, Act, Assert) — one main assertion per test.
REQUIRED: Mock only the database boundary (repository) when testing a service — never mock business logic.
REQUIRED: Controller tests via `supertest` cover the error envelope (`{error, code, fields}`), not just the HTTP status.
FORBIDDEN: Service tests hitting a real database — mock the repository instead.
FORBIDDEN: Tests that depend on execution order or shared global state.
FORBIDDEN: Business logic inside `beforeEach`/`afterEach`.

## TOOLING
- **Framework:** Jest 29 + ts-jest
- **Assertions:** `expect` (Jest)
- **HTTP:** `supertest`
- **Coverage:** `jest --coverage`
- **CI Integration:** TBD — no pipeline configured yet

## TROUBLESHOOTING
- **Flaky tests:** run with `--runInBand` (already the default in the `test` script) to eliminate concurrency between DB tests.
- **Debug mode:** `node --inspect-brk node_modules/.bin/jest --runInBand <file>`.
- **Open handles after tests finish:** `npm test -- --detectOpenHandles` (e.g. an unclosed MySQL pool).
