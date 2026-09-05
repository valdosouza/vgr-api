# Project Documentation

Index of project technical documentation for **VGR API**. Use the links below to navigate the available documents.

## Documentation Index
**RULE:** Only reference documents located in `./docs/adr/` or `./docs/feature/`. No other folders are permitted. Always validate that referenced files exist in one of these directories before finalizing the document.

| Document | Description | Reading |
|----------|-------------|----------|
| [**ARCHITECTURE.md**](./adr/ARCHITECTURE.md) | Architecture, folder organization, and code patterns for the project. | **Mandatory** |
| [**TESTS.md**](./adr/TESTS.md) | Testing strategies, patterns, and execution commands. | **Mandatory** |
| [**RELEASE.md**](./adr/RELEASE.md) | Release checklist and the env vars production refuses to boot without (decisions 110-118). | **Mandatory before deploy** |
| [**access-control.md**](./feature/access-control.md) | Per-user permission model, dynamic menu and per-endpoint enforcement (decisions 68-75). | Optional |
| [**auth.md**](./feature/auth.md) | Panel login: revocable 15min sessions, progressive delay, mandatory TOTP 2FA (decisions 67, 112-114). | Optional |
| [**app-auth.md**](./feature/app-auth.md) | App users (reporters/helpers): the SECOND authentication plane, never crossed with the panel (decisions 119-124). | Optional |
| [**legal-gate.md**](./feature/legal-gate.md) | Per-jurisdiction execution blocking by capability, fail-closed (decisions 76-79, 103-109). | Optional |
| [**admin-audit.md**](./feature/admin-audit.md) | Append-only trail of who did what on the panel, and its read-only screen endpoints under the `admin_audit` grant (decisions 116, 165, 166). | Optional |
| [**media.md**](./feature/media.md) | Evidence images: BlobStore, EXIF-stripping re-encode, crypto-shredding (decisions 126-132). | Optional |
| [**identity.md**](./feature/identity.md) | Role/AnonymityMode model and the append-only accountability log (decisions 4, 6, 23). | Optional |
| [**dual-control-access.md**](./feature/dual-control-access.md) | Two-distinct-approver gate for decrypting at-risk data (decision 45). | Optional |
| [**risk-config.md**](./feature/risk-config.md) | RiskTier-per-Category registry, admin-managed (decision 46). | Optional |
| [**monetization-config.md**](./feature/monetization-config.md) | Fee rule and allowed payment modes per Category (decisions 39, 58). | Optional |
| [**reports.md**](./feature/reports.md) | App-plane report lifecycle: submit, edit, resolve, visibility, media attach, case freeze (decisions 134-142). | Optional |
| [**report-moderation.md**](./feature/report-moderation.md) | Panel search + case detail with degraded position, audited reads and the exact-position grant; hide/unhide a report and block/unblock a media with a catalog reason; aggregated statistics under the k = 5 floor (decisions 158-167). | Optional |
| [**chat.md**](./feature/chat.md) | Masked reporter-helper chat on the app plane: eligibility, opaque participant tokens, anti-contact filter, cursor delivery, lifecycle, limits, Legal Gate capability `chat.masked`; plus the audited panel read under the no-bootstrap `chat_evidence` grant (decisions 54, 169-177). | Optional |
| [**rating.md**](./feature/rating.md) | Helper rating on the app plane: the report owner rates one help offer of a resolved case (integer 1..5, once, idempotent by clientKey); the score accumulates on the helper's internal identity; the helper reads only their own `{ count, average }` under the k = 5 floor; Legal Gate capability `helper.rating` (decisions 48, 178-189). | Optional |
| [**panic.md**](./feature/panic.md) | Panic button PP1: single-shot alert to the Authorized Responder pool, cursor-polled inbox, cooldown anti-abuse, degraded distance, Legal Gate capability `panic.dispatch`; plus the responder-pool `POST` plane fix and the closure of decision 52 (decisions 51, 190-199). | Optional |
| [**panic-responders.md**](./feature/panic-responders.md) | Superseded — folded into `panic.md`. | Optional |
| [**direction-sightings.md**](./feature/direction-sightings.md) | Direction sighting DS1: any viewer of an open, eligible-category report logs one of 8 compass directions; synchronous weighted reconciliation (identified weighs more than anonymous), exposed only above a disclosure floor, Legal Gate capability `location.tracking` (decisions 200-207, closing 22/26/27/28). | Optional |

## Recommended Reading Order

1. **adr/ARCHITECTURE.md** — technical foundation and project organization.
2. **adr/TESTS.md** — code validation and quality.
3. Additional documents in adr/ or feature/ folders as needed for the task.
