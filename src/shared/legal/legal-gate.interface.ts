import { Capability } from '@shared/legal/capabilities'

/** Rule verdict (decision 78). */
export type CapabilityStatus = 'allowed' | 'restricted' | 'blocked'

/** Typed block motive (decision 78) — mandatory whenever not allowed. */
export type BlockReason = 'no_control' | 'legislation' | 'self_preservation'

/** Kill switch states (plan §7). Read with TTL zero. */
export type OperationalState = 'live' | 'restricted' | 'suspended'

export interface JurisdictionRow {
  code: string
  name: string
  operationalState: OperationalState
  isSandbox: boolean
  pendingState: OperationalState | null
  pendingBy: number | null
}

/** The latest active rule for capability x jurisdiction (tb_legal_rule). */
export interface ActiveRuleRow {
  id: number
  capability: string
  jurisdictionCode: string
  version: number
  status: CapabilityStatus
  reason: BlockReason | null
  reviewState: 'none' | 'ai_assessed' | 'counsel_confirmed'
  expiresAt: Date | null
}

/**
 * Why the gate decided what it decided. Bounded to 20 chars — it is stored
 * in tb_legal_gate_audit.reason.
 */
export type GateReason =
  | BlockReason
  /** No active (or unexpired) rule in a real jurisdiction (decision 104). */
  | 'unreviewed'
  /** Key absent from the TS catalog — typo guard (decision 103). */
  | 'unknown_capability'
  /** Jurisdiction row missing/unresolvable — fail closed. */
  | 'unknown_state'
  /** Kill switch (decision 107). */
  | 'suspended'
  /** Jurisdiction restricted: only explicit 'allowed' rules pass (plan §7). */
  | 'restricted'
  /** A required capability is not allowed here (decision 98). */
  | 'dependency'
  /** Gate lookup failed and the degraded window is exhausted (decision 109). */
  | 'unavailable'

export interface GateDecision {
  allowed: boolean
  /** Sandbox allow — every response must carry the demo mark (decision 79). */
  demo: boolean
  /** Served from stale cache during a DB outage (decision 109). */
  degraded: boolean
  /** Rule said 'restricted' — caller applies its declared restriction. */
  restricted: boolean
  reason?: GateReason
  rule?: { id: number; version: number }
}

/** Request context carried into the audit trail (plan L6). */
export interface GateContext {
  userRef?: string
  ip?: string
}

export interface AuditEntry {
  capability: Capability | string
  jurisdictionCode: string
  ruleId: number | null
  ruleVersion: number | null
  outcome: 'blocked' | 'demo' | 'degraded'
  reason: string | null
  userRef: string | null
  ip: string | null
}
