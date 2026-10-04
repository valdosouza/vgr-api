import * as repository from '@modules/admin-access/dual-control.repository'
import { DualControlAccessRequestRow } from '@modules/admin-access/dual-control.interface'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'
import { PagedQuery, PagedResult, pagedOrPlain } from '@shared/http/paged-query'

/** The house rule of decisions 107/141d applied to decision 45 (224):
 *  opening the request is the first authorization, ONE approval by a
 *  different user grants it. Both actors are session user ids (223). */

function notAwaitingApproval(): HttpError {
  return new HttpError(409, 'Request is not awaiting approval', undefined, ErrorCodes.BUSINESS_RULE)
}

async function getRequest(id: number): Promise<DualControlAccessRequestRow> {
  const request = await repository.findRequestById(id)
  if (!request) {
    throw new HttpError(404, 'Dual control request not found', undefined, ErrorCodes.NOT_FOUND)
  }
  return request
}

export async function createDualControlRequest(
  accountabilityLogEntryId: number,
  legalBasis: string,
  requestedBy: number
): Promise<DualControlAccessRequestRow> {
  // Decision 226: no request for an entry that does not exist.
  if (!(await repository.accountabilityEntryExists(accountabilityLogEntryId))) {
    throw new HttpError(404, 'Accountability log entry not found', undefined, ErrorCodes.NOT_FOUND)
  }
  const id = await repository.createRequest(accountabilityLogEntryId, legalBasis, requestedBy)
  return getRequest(id)
}

/** Plain array without `page`, `{ items, page, pageSize, total }` with it
 *  (decision 220); newest first, filter on the legal basis (227). */
export async function listDualControlRequests(
  query: PagedQuery
): Promise<DualControlAccessRequestRow[] | PagedResult<DualControlAccessRequestRow>> {
  return pagedOrPlain(
    query,
    (window) => repository.listRequests(query.filter, window),
    () => repository.countRequests(query.filter)
  )
}

export async function approveDualControlRequest(id: number, approvedBy: number): Promise<DualControlAccessRequestRow> {
  const request = await getRequest(id)
  // Granted already, or voided by decision 225 — neither can be approved.
  if (request.status !== 'pending') throw notAwaitingApproval()
  if (request.requestedBy === approvedBy) {
    throw new HttpError(
      422,
      'The approver must be a different user than the requester',
      undefined,
      ErrorCodes.BUSINESS_RULE
    )
  }

  // Lost the race to a simultaneous approval (224): the first one stands.
  if (!(await repository.grantRequest(id, approvedBy))) throw notAwaitingApproval()
  return getRequest(id)
}
