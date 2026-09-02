import { isValidBrTaxId, isValidCnpj, isValidCpf } from '@modules/reward/br-tax-id'

/**
 * Decision 155: CPF/CNPJ check digits are validated on BOTH sides (API and
 * app). The app's `vgr_validators` mirrors this file test by test — keep
 * the fixtures identical when changing either side (decision 154).
 */
describe('br-tax-id (decision 155)', () => {
  describe('isValidCpf', () => {
    it('accepts a CPF with correct check digits', () => {
      expect(isValidCpf('52998224725')).toBe(true)
    })

    it('rejects a CPF whose last check digit is wrong', () => {
      expect(isValidCpf('52998224726')).toBe(false)
    })

    it('rejects a CPF whose first check digit is wrong', () => {
      expect(isValidCpf('52998224735')).toBe(false)
    })

    it('rejects the classic all-same-digit sequences even though their digits "check"', () => {
      for (const d of '0123456789') expect(isValidCpf(d.repeat(11))).toBe(false)
    })

    it('rejects anything that is not exactly 11 digits (masks are the client’s job)', () => {
      expect(isValidCpf('529.982.247-25')).toBe(false)
      expect(isValidCpf('5299822472')).toBe(false)
      expect(isValidCpf('529982247250')).toBe(false)
      expect(isValidCpf('')).toBe(false)
    })
  })

  describe('isValidCnpj', () => {
    it('accepts a CNPJ with correct check digits', () => {
      expect(isValidCnpj('11222333000181')).toBe(true)
    })

    it('rejects a CNPJ whose check digits are wrong', () => {
      expect(isValidCnpj('11222333000182')).toBe(false)
      expect(isValidCnpj('11222333000191')).toBe(false)
    })

    it('rejects all-same-digit sequences', () => {
      for (const d of '0123456789') expect(isValidCnpj(d.repeat(14))).toBe(false)
    })

    it('rejects anything that is not exactly 14 digits', () => {
      expect(isValidCnpj('11.222.333/0001-81')).toBe(false)
      expect(isValidCnpj('1122233300018')).toBe(false)
    })
  })

  describe('isValidBrTaxId', () => {
    it('dispatches by length: 11 → CPF, 14 → CNPJ', () => {
      expect(isValidBrTaxId('52998224725')).toBe(true)
      expect(isValidBrTaxId('11222333000181')).toBe(true)
    })

    it('rejects lengths that are neither (12/13 digits used to pass the old min(11).max(14))', () => {
      expect(isValidBrTaxId('529982247251')).toBe(false)
      expect(isValidBrTaxId('5299822472511')).toBe(false)
    })
  })
})
