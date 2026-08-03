import * as repository from '@modules/admin-access/dual-control.repository'
import { DualControlAccessRequestRow, DualControlStatus } from '@modules/admin-access/dual-control.interface'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'

export async function createDualControlRequest(
  accountabilityLogEntryId: number,
  legalBasis: string
): Promise<DualControlAccessRequestRow> {
  return repository.createRequest(accountabilityLogEntryId, legalBasis)
}

export async function listDualControlRequests(): Promise<DualControlAccessRequestRow[]> {
  return repository.findAllRequests()
}

/** Grants only once 2 DISTINCT approverIds are recorded (decision 45) — a
 *  duplicate approverId on the same request is rejected, never counted twice. */
export async function addApproval(id: number, approverId: string): Promise<DualControlAccessRequestRow> {
  const req = await repository.findRequestById(id)
  if (!req) {
    throw new HttpError(404, 'Dual control request not found', undefined, ErrorCodes.NOT_FOUND)
  }
  if (req.approverIds.includes(approverId)) {
    throw new HttpError(409, 'This approver has already approved this request', undefined, ErrorCodes.DUPLICATE)
  }

  const approverIds = [...req.approverIds, approverId]
  const status: DualControlStatus = approverIds.length >= 2 ? 'granted' : 'pending'
  await repository.persistApproval(id, approverIds, status)

  return { ...req, approverIds, status }
}
