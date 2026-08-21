import {
  PaymentRail,
  PaymentRecipient,
  RecipientOnboardingInput,
  RetainedCharge,
  RetainedChargeInput,
  RetentionState,
} from '@shared/payment/payment-rail'

/**
 * Asaas adapter for the PaymentRail port (decision 96/100/143) — candidate
 * found while researching the PSP checklist (plano-psp-requisitos.md), NOT
 * yet the closed decision 59. Asaas is the only provider found whose public
 * docs describe conditional retention (Conta Escrow) with the value held
 * inside the RECIPIENT's own subconta, not a VGR-titled account — the shape
 * B1 requires.
 *
 * Endpoints below are taken from docs.asaas.com (fetched 2026-08-20) and are
 * believed accurate, but three checklist items are still UNCONFIRMED with
 * Asaas support — decision 36/37 applies (specs are binding; amend before
 * diverging) once real integration proves any of this wrong:
 *
 *  - B2/B3: whether split (N recipients) and Conta Escrow retention compose
 *    on the SAME charge. Docs describe them separately; never verified
 *    together.
 *  - B4: refund of a charge still under escrow retention. `POST
 *    /v3/payments/{id}/refund` documents Pix refund generally and the
 *    escrow status schema recognizes `finishReason: PAYMENT_REFUNDED`, but
 *    no doc page confirms the combination explicitly.
 *  - D1: `daysToExpire` is the only documented retention limit — no
 *    document describes a plan/business-side maximum.
 *
 * Do not point this adapter at a real charge before those three are
 * confirmed with Asaas directly (§4 of plano-psp-requisitos.md).
 */
export class AsaasPaymentRail implements PaymentRail {
  constructor(
    private readonly config: {
      apiUrl: string
      apiKey: string
      /** Days the retained value stays blocked before automatic release —
       *  Asaas's only documented retention limit (open item D1). */
      escrowDaysToExpire: number
    }
  ) {}

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.config.apiUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        access_token: this.config.apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      throw new Error(`Asaas ${method} ${path} failed: ${res.status} ${await res.text()}`)
    }
    return (await res.json()) as T
  }

  async onboardRecipient(input: RecipientOnboardingInput): Promise<PaymentRecipient> {
    const account = await this.request<{ id: string; walletId: string }>('POST', '/v3/accounts', {
      name: input.legalName,
      email: input.email,
      cpfCnpj: input.taxId,
      mobilePhone: input.mobilePhone,
      incomeValue: input.monthlyIncome,
      address: input.address.street,
      addressNumber: input.address.number,
      province: input.address.neighborhood,
      postalCode: input.address.postalCode,
    })

    // Escrow only retains charges received AFTER it is enabled on the
    // subconta — must run once, right after onboarding, before any charge.
    await this.request('POST', `/v3/accounts/${account.id}/escrow`, {
      enabled: true,
      daysToExpire: this.config.escrowDaysToExpire,
      isFeePayer: false,
    })

    // walletId, not account id, is what a charge's split references.
    return { railRecipientId: account.walletId }
  }

  private async resolveCustomerId(taxId: string, name: string): Promise<string> {
    const found = await this.request<{ data: Array<{ id: string }> }>(
      'GET',
      `/v3/customers?cpfCnpj=${encodeURIComponent(taxId)}`
    )
    if (found.data[0]) return found.data[0].id

    const created = await this.request<{ id: string }>('POST', '/v3/customers', {
      name,
      cpfCnpj: taxId,
    })
    return created.id
  }

  async reserve(input: RetainedChargeInput): Promise<RetainedCharge> {
    const customerId = await this.resolveCustomerId(input.payerTaxId, input.payerName)
    const dueDate = new Date().toISOString().slice(0, 10)

    const payment = await this.request<{ id: string }>('POST', '/v3/payments', {
      customer: customerId,
      billingType: 'PIX',
      value: input.amountCents / 100,
      dueDate,
      split: input.recipients.map((r) => ({
        walletId: r.railRecipientId,
        fixedValue: r.amountCents / 100,
      })),
    })

    return { railChargeId: payment.id }
  }

  /**
   * Asaas has no documented "release to recipient" call that takes a
   * destination — `POST /v3/escrow/{id}/finish` just lets the charge follow
   * its normal flow (the split already routed value to the recipients'
   * subcontas at payment time; escrow only delayed availability). The
   * escrow id is per-charge, resolved via getRetentionState first.
   */
  async capture(railChargeId: string): Promise<void> {
    const escrow = await this.request<{ id: string; status: string }>(
      'GET',
      `/v3/payments/${railChargeId}/escrow`
    )
    if (escrow.status === 'DONE') return
    await this.request('POST', `/v3/escrow/${escrow.id}/finish`, {})
  }

  /** UNCONFIRMED (B4) — see class header. */
  async cancel(railChargeId: string): Promise<void> {
    await this.request('POST', `/v3/payments/${railChargeId}/refund`, {})
  }

  async getRetentionState(railChargeId: string): Promise<RetentionState> {
    const escrow = await this.request<{ status: 'ACTIVE' | 'DONE'; finishReason?: string }>(
      'GET',
      `/v3/payments/${railChargeId}/escrow`
    )
    if (escrow.status === 'ACTIVE') return 'retained'
    if (escrow.finishReason === 'PAYMENT_REFUNDED') return 'refunded'
    if (escrow.finishReason === 'EXPIRED' || escrow.finishReason === 'CUSTOMER_CONFIG_DISABLED') {
      return 'released'
    }
    return 'unknown'
  }
}
