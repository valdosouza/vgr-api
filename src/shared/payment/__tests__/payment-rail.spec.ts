import { paymentRail, resetPaymentRailForTests } from '@shared/payment/payment-rail'
import { AsaasPaymentRail } from '@shared/payment/asaas-payment-rail'

describe('paymentRail factory (decision 96/143)', () => {
  afterEach(() => {
    resetPaymentRailForTests()
    delete process.env.ASAAS_API_KEY
  })

  it('resolves the Asaas adapter and memoizes the instance', () => {
    process.env.ASAAS_API_KEY = 'test-key'
    const first = paymentRail()
    const second = paymentRail()

    expect(first).toBeInstanceOf(AsaasPaymentRail)
    expect(first).toBe(second)
  })

  it('creates a fresh instance after resetPaymentRailForTests', () => {
    const first = paymentRail()
    resetPaymentRailForTests()
    const second = paymentRail()

    expect(first).not.toBe(second)
  })
})
