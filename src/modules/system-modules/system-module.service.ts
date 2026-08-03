import * as repository from '@modules/system-modules/system-module.repository'
import { SystemModuleInput, SystemModuleRow } from '@modules/system-modules/system-module.interface'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'

export async function listSystemModules(filter?: string): Promise<SystemModuleRow[]> {
  return repository.listSystemModules(filter)
}

export async function getSystemModule(id: number): Promise<SystemModuleRow> {
  const row = await repository.findSystemModuleById(id)
  if (!row) {
    throw new HttpError(404, 'Module not found', undefined, ErrorCodes.NOT_FOUND)
  }
  return row
}

async function assertInterfacesExist(interfaceIds: number[]): Promise<void> {
  if (!(await repository.interfacesExist(interfaceIds))) {
    throw new HttpError(422, 'One or more interfaces do not exist', undefined, ErrorCodes.VALIDATION_FAILED)
  }
}

export async function createSystemModule(input: SystemModuleInput): Promise<SystemModuleRow> {
  await assertInterfacesExist(input.interfaceIds)
  const id = await repository.insertSystemModule(input)
  await repository.syncModuleInterfaces(id, input.interfaceIds)
  return getSystemModule(id)
}

export async function updateSystemModule(id: number, input: SystemModuleInput): Promise<SystemModuleRow> {
  await getSystemModule(id)
  await assertInterfacesExist(input.interfaceIds)
  await repository.updateSystemModule(id, input)
  await repository.syncModuleInterfaces(id, input.interfaceIds)
  return getSystemModule(id)
}

export async function deleteSystemModule(id: number): Promise<void> {
  await getSystemModule(id)
  // Deleting a module never deletes screens or grants — interfaces simply
  // fall back to their group_default grouping on the menu (decision 71).
  await repository.softDeleteSystemModule(id)
}
