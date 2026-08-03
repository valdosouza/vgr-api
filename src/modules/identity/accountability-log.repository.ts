/**
 * The write-side implementation moved to @shared/audit/accountability when
 * SubmitReport became its second caller (report-front amendment E8 —
 * modules never import each other). This re-export keeps the module's
 * public surface and the no-controller guarantee unchanged: nothing here
 * is ever readable through a public-facing route.
 */
export { appendAccountabilityLogEntry } from '@shared/audit/accountability'
