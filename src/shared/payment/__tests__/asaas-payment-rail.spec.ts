import { AsaasPaymentRail } from '@shared/payment/asaas-payment-rail'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

describe('AsaasPaymentRail (research candidate — decision 96/100, not decision 59)', () => {
  let rail: AsaasPaymentRail
  let fetchMock: jest.Mock

  beforeEach(() => {
    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    rail = new AsaasPaymentRail({
      apiUrl: 'https://api-sandbox.asaas.com',
      apiKey: 'test-key',
      escrowDaysToExpire: 30,
    })
  })

  it('onboards a recipient: creates the subconta, then enables escrow on it', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { id: 'acc_1', walletId: 'wallet_1' }))
      .mockResolvedValueOnce(jsonResponse(200, { enabled: true }))

    const recipient = await rail.onboardRecipient({
      legalName: 'Helper One',
      email: 'helper@example.com',
      taxId: '00000000000',
      mobilePhone: '11999999999',
      monthlyIncome: 3000,
      address: { street: 'Rua X', number: '10', neighborhood: 'Centro', postalCode: '01000000' },
    })

    expect(recipient.railRecipientId).toBe('wallet_1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api-sandbox.asaas.com/v3/accounts')
    expect(fetchMock.mock.calls[1][0]).toBe('https://api-sandbox.asaas.com/v3/accounts/acc_1/escrow')
    const escrowBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(escrowBody).toEqual({ enabled: true, daysToExpire: 30, isFeePayer: false })
  })

  it('charges with retention: resolves an existing customer by taxId and splits across recipients', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ id: 'cus_1' }] }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'pay_1' }))

    const charge = await rail.reserve({
      amountCents: 15000,
      payerTaxId: '11111111111',
      payerName: 'Reporter One',
      recipients: [{ railRecipientId: 'wallet_1', amountCents: 15000 }],
    })

    expect(charge.railChargeId).toBe('pay_1')
    const paymentBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(paymentBody.billingType).toBe('PIX')
    expect(paymentBody.value).toBe(150)
    expect(paymentBody.split).toEqual([{ walletId: 'wallet_1', fixedValue: 150 }])
  })

  it('creates a new customer when none exists for the payer taxId', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'cus_new' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'pay_2' }))

    await rail.reserve({
      amountCents: 5000,
      payerTaxId: '22222222222',
      payerName: 'New Reporter',
      recipients: [{ railRecipientId: 'wallet_2', amountCents: 5000 }],
    })

    expect(fetchMock.mock.calls[1][0]).toBe('https://api-sandbox.asaas.com/v3/customers')
  })

  it('release: looks up the escrow id from the charge, then finishes it', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { id: 'escrow_1', status: 'ACTIVE' }))
      .mockResolvedValueOnce(jsonResponse(200, {}))

    await rail.capture('pay_1')

    expect(fetchMock.mock.calls[0][0]).toBe('https://api-sandbox.asaas.com/v3/payments/pay_1/escrow')
    expect(fetchMock.mock.calls[1][0]).toBe('https://api-sandbox.asaas.com/v3/escrow/escrow_1/finish')
  })

  it('release: is a no-op when the escrow is already DONE', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'escrow_1', status: 'DONE' }))

    await rail.capture('pay_1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refund: calls the payment refund endpoint directly', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}))

    await rail.cancel('pay_1')

    expect(fetchMock.mock.calls[0][0]).toBe('https://api-sandbox.asaas.com/v3/payments/pay_1/refund')
  })

  it.each([
    [{ status: 'ACTIVE' }, 'retained'],
    [{ status: 'DONE', finishReason: 'PAYMENT_REFUNDED' }, 'refunded'],
    [{ status: 'DONE', finishReason: 'EXPIRED' }, 'released'],
    [{ status: 'DONE', finishReason: 'CUSTOMER_CONFIG_DISABLED' }, 'released'],
    [{ status: 'DONE', finishReason: 'INSUFFICIENT_BALANCE' }, 'unknown'],
  ])('maps escrow status %j to retention state %s', async (escrowResponse, expected) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, escrowResponse))

    expect(await rail.getRetentionState('pay_1')).toBe(expected)
  })

  it('throws with status and body when a call fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { errors: [{ description: 'bad taxId' }] }))

    await expect(rail.cancel('pay_1')).rejects.toThrow('Asaas POST /v3/payments/pay_1/refund failed: 400')
  })
})
