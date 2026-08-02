# Project Architecture

## OVERVIEW
Modular Express/TypeScript API, mirroring the `setes-api` structure
(`D:\Gestao2027\setes-api`) by explicit product-owner decision. Each business
domain ("cadastro") is a module with 6 fixed files, symmetric to the
equivalent module in the Flutter app at `D:\ProjetoVGR\app`. Flow: routes →
controller → service → repository → MySQL.

## FOLDER STRUCTURE
<folder_structure>
D:\ProjetoVGR\api/
├── src/
│   ├── gateway/            # Cross-cutting middlewares & route entry point
│   │   ├── auth.middleware.ts       # JWT validation
│   │   ├── rate-limit.middleware.ts # Per-IP rate limiting
│   │   └── router.ts                # Module registration at /api/<module>
│   ├── modules/            # One business module per folder (empty — first module comes from scope-refinement)
│   │   └── <module>/       # <m>.interface.ts · <m>.dto.ts · <m>.repository.ts · <m>.service.ts · <m>.controller.ts · <m>.routes.ts
│   ├── migrations/         # Database schema management
│   │   ├── runner.ts       # Applies src/migrations/sql/NNN_*.sql in order, tracked in _migrations
│   │   └── sql/            # One numbered file per schema change
│   ├── shared/
│   │   ├── db/connection.ts     # MySQL pool (decimalNumbers:true — NEVER remove)
│   │   ├── errors/http-error.ts # Custom HTTP error class
│   │   ├── errors/error-codes.ts # Catalog of known error codes
│   │   ├── http/controller-utils.ts # handleError + parseId + parseBody (every controller uses these)
│   │   ├── logger/logger.ts     # Simple timestamped logger
│   │   └── types/express.d.ts   # req.user type augmentation
│   ├── app.ts              # Express app configuration
│   └── server.ts           # Server bootstrap
└── scripts/
    └── run-migrations.ts   # CLI to run migrations manually
</folder_structure>

## LAYERS
- **Gateway**: cross-cutting middlewares (auth, rate-limit) and route registration. PROHIBITED: business logic.
- **Module (routes → controller → service → repository)**: one domain per folder. PROHIBITED: one module importing another module — shared dependencies go to `shared/`.
- **Shared**: generic infrastructure with no business rule belonging to any specific module.

## MODULES
| Module | Responsibility | Location |
|--------|-----------------|-------------|
| gateway | JWT auth, rate limiting, route registration | `src/gateway/` |
| modules/* | One business domain per folder (report, help offer, reward — to be defined by `scope-refinement`) | `src/modules/<module>/` |
| migrations | MySQL schema versioning | `src/migrations/` |
| shared | DB, errors, logger, types | `src/shared/` |

## PATTERNS
<code_patterns>
# REQUIRED: one file per responsibility inside the module (setes-api pattern)
// <m>.interface.ts — Row/Input types
export interface ReportRow { id: number; category: string; subject: string | null }

// <m>.dto.ts — Zod validation
export const reportCreateDto = z.object({ category: z.string().min(1), subject: z.string().optional() })

// <m>.repository.ts — pure SQL
export async function listReports(): Promise<ReportRow[]> {
  const [rows] = await pool.query<any[]>(`SELECT id, category, subject FROM tb_report WHERE deleted='N'`)
  return rows
}

// <m>.service.ts — business rule, throws HttpError
export async function createReport(input: ReportInput) {
  // business rules here (never raw SQL, never req/res)
}

// <m>.controller.ts — HTTP ↔ service, { ok, data } envelope
export async function create(req: Request, res: Response) {
  const body = parseBody(reportCreateDto, req, res); if (body === null) return
  try { res.status(201).json({ ok: true, data: await createReport(body) }) }
  catch (err) { handleError(res, err, 'reports POST') }
}

# FORBIDDEN: a module importing another module
import { something } from '@modules/other-module/other.service'  // PROHIBITED — promote to @shared
</code_patterns>

## INTERNATIONALIZATION
REQUIRED: All source code, identifiers, comments, and log messages in English (project-wide standard).
REQUIRED: API error messages returned to clients are in English for the MVP (no server-side i18n yet — see decision 17 in VGR-plano.md).
⚠️ Multi-language API error messages (real i18n on the API side) are deferred to a future phase — flagged as an open question, not yet decided.

## INTEGRATIONS
| External Service / Component | Purpose | Connection / Authentication Method |
|------------------------------|---------|-------------------------------------|
| MySQL | Persistence (`tb_` prefix, soft delete `deleted='S'/'N'`) | `mysql2/promise`, pool via `shared/db/connection.ts` |
| vgr-app (`D:\ProjetoVGR\app`) | Flutter client | JWT Bearer via `gateway/auth.middleware.ts` |

⚠️ **To be defined in `scope-refinement`**: whether VGR needs multi-tenancy
(schema per institution, like setes-api) or a single schema — today
`migrations/runner.ts` assumes a single schema. If multi-tenancy is decided,
mirror `runMigrationsForAllInstitutions` from setes-api.

## REFERENCES

- [**README.md**](../README.md): Documentation navigation index.
- [**TESTS.md**](./TESTS.md): Testing strategies and commands.
- [**vgr-app ARCHITECTURE.md**](D:\ProjetoVGR\app\docs\adr\ARCHITECTURE.md): client side, same module-to-module symmetry.
- Pattern source: `D:\Gestao2027\setes-api` and `D:\Gestao2027\Infra-IA\setes-api\ARQUITETURA_MODULOS_API.md`.
