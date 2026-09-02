import { onboardRecipientDto, reserveRewardDto } from '@modules/reward/reward.dto'
import { zodToFields } from '@shared/http/controller-utils'
import { FieldErrorCodes } from '@shared/errors/error-codes'

const VALID_CPF = '52998224725'
const VALID_CNPJ = '11222333000181'

const onboardBase = {
  legalName: 'Helper One',
  email: 'helper@example.com',
  taxId: VALID_CPF,
  mobilePhone: '11999998888',
  monthlyIncome: 3000,
  address: { street: 'Rua A', number: '10', neighborhood: 'Centro', postalCode: '01001000' },
}

const reserveBase = {
  noReturnNoticeVersion: 'v1',
  payerTaxId: VALID_CPF,
  payerName: 'Payer One',
  recipients: [{ helpOfferId: 1, amountCents: 1000 }],
}

/** Decision 155: the tax id DTOs validate check digits, digits only. */
describe('reward DTOs — taxId / payerTaxId (decision 155)', () => {
  it.each([
    ['CPF', VALID_CPF],
    ['CNPJ', VALID_CNPJ],
  ])('onboardRecipientDto accepts a valid %s', (_, taxId) => {
    expect(onboardRecipientDto.safeParse({ ...onboardBase, taxId }).success).toBe(true)
  })

  it('onboardRecipientDto rejects a CPF with a wrong check digit as INVALID_FORMAT on taxId', () => {
    const r = onboardRecipientDto.safeParse({ ...onboardBase, taxId: '52998224726' })
    expect(r.success).toBe(false)
    if (r.success) return
    const fields = zodToFields(r.error)
    expect(fields).toEqual([
      expect.objectContaining({ field: 'taxId', code: FieldErrorCodes.INVALID_FORMAT }),
    ])
  })

  it('onboardRecipientDto rejects a masked CPF — the client sends digits only', () => {
    const r = onboardRecipientDto.safeParse({ ...onboardBase, taxId: '529.982.247-25' })
    expect(r.success).toBe(false)
    if (r.success) return
    expect(zodToFields(r.error)[0]).toEqual(
      expect.objectContaining({ field: 'taxId', code: FieldErrorCodes.INVALID_FORMAT })
    )
  })

  it('onboardRecipientDto rejects 12/13-digit strings that the old length-only rule let through', () => {
    expect(onboardRecipientDto.safeParse({ ...onboardBase, taxId: '529982247251' }).success).toBe(false)
  })

  it('reserveRewardDto applies the same rule to payerTaxId', () => {
    expect(reserveRewardDto.safeParse(reserveBase).success).toBe(true)
    expect(reserveRewardDto.safeParse({ ...reserveBase, payerTaxId: VALID_CNPJ }).success).toBe(true)
    const bad = reserveRewardDto.safeParse({ ...reserveBase, payerTaxId: '11111111111' })
    expect(bad.success).toBe(false)
    if (bad.success) return
    expect(zodToFields(bad.error)[0]).toEqual(
      expect.objectContaining({ field: 'payerTaxId', code: FieldErrorCodes.INVALID_FORMAT })
    )
  })
})
