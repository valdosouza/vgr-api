import { findContact } from '@shared/chat/contact-filter'

/**
 * Anti-contact rule of decision 171: the chat is for coordinating help,
 * never for moving the conversation off-platform (54: "sem compartilhar
 * contato direto"). The server is the authority; the app only mirrors
 * this rule for early feedback (vgr_validators, 154).
 */
describe('contact filter (decision 171)', () => {
  describe('phone numbers (>= 8 digits, mask-tolerant)', () => {
    it.each([
      ['plain 8 digits', 'me liga 91234567'],
      ['9 digits with dash', 'chama 91234-5678'],
      ['area code in parentheses', 'tel (11) 91234-5678'],
      ['international prefix', 'liga +55 11 91234 5678'],
      ['dots as separators', 'meu numero 11.9.1234.5678'],
      ['spaces only', '11 9 1234 5678 me chama'],
    ])('flags %s', (_label, text) => {
      expect(findContact(text)).toMatchObject({ kind: 'phone' })
    })

    it('carries the offending excerpt so the client can point at it', () => {
      const hit = findContact('me liga no (11) 91234-5678 depois')
      expect(hit?.match).toBe('(11) 91234-5678')
    })

    it('exactly 8 digits is the boundary: 8 fails, 7 passes', () => {
      expect(findContact('protocolo 12345678')).toMatchObject({ kind: 'phone' })
      expect(findContact('protocolo 1234567')).toBeNull()
    })

    it('a masked number under 8 digits passes (case id 1234-567)', () => {
      expect(findContact('caso 1234-567 aberto')).toBeNull()
    })
  })

  describe('false-positive guards — ordinary numbers pass', () => {
    it.each([
      ['house number', 'Rua A, 123'],
      ['bare address with complement', 'Av. Paulista, 1578, apto 42'],
      ['time with h', 'te encontro às 15h30'],
      ['time with colon', 'chego 15:30'],
      ['money', 'custa R$ 1.500,00'],
      ['date', 'vi no dia 03/09/2026 de manhã'],
      ['case id under 8 digits', 'boletim 2026-123'],
      ['distance and age', 'uns 300 metros, criança de 7 anos'],
      ['plain sentence', 'estou perto da praça, posso ir agora'],
      ['"face" as an ordinary word (removed from the messenger list, 2026-09-03)', 'em face de 3 pessoas'],
      ['empty', ''],
    ])('%s passes', (_label, text) => {
      expect(findContact(text)).toBeNull()
    })
  })

  describe('e-mails', () => {
    it('flags an e-mail address', () => {
      expect(findContact('manda pra ana.silva@example.com')).toEqual({
        kind: 'email',
        match: 'ana.silva@example.com',
      })
    })

    it('is case-insensitive', () => {
      expect(findContact('ANA@EXAMPLE.COM')).toMatchObject({ kind: 'email' })
    })
  })

  describe('URLs', () => {
    it.each([
      ['http', 'veja http://exemplo.com/x'],
      ['https', 'https://exemplo.com.br'],
      ['www', 'entra em www.exemplo.com'],
      ['bare domain.tld', 'meu site exemplo.com'],
      ['bare domain with 2-letter tld', 'acessa exemplo.io agora'],
    ])('flags %s', (_label, text) => {
      expect(findContact(text)).toMatchObject({ kind: 'url' })
    })

    it('a sentence ending with a period followed by a space is not a domain', () => {
      expect(findContact('fui até lá. Nada')).toBeNull()
    })
  })

  describe('@handles', () => {
    it('flags @handle with >= 3 chars', () => {
      expect(findContact('me acha no @ana_silva')).toEqual({ kind: 'handle', match: '@ana_silva' })
    })

    it('a handle shorter than 3 chars passes', () => {
      expect(findContact('vou @ai')).toBeNull()
    })

    it('an e-mail is reported as e-mail, not as a handle', () => {
      expect(findContact('x@exemplo.com')).toMatchObject({ kind: 'email' })
    })
  })

  describe('messenger names followed by a number or handle', () => {
    it.each([
      ['whats + number', 'me chama no whats 4567'],
      ['whatsapp + number', 'WhatsApp: 4567'],
      ['zap + number', 'zap 4567'],
      ['telegram + handle', 'telegram @ana'],
      ['insta + handle', 'insta @ana'],
      ['instagram + number', 'instagram 4567'],
      ['signal + number', 'signal 4567'],
      ['discord + handle', 'discord @ana'],
      ['tiktok + handle', 'tiktok @ana'],
      ['facebook + handle', 'facebook @ana'],
      ['number within 40 chars', 'me procura no telegram que o final e 4567'],
    ])('flags %s', (_label, text) => {
      expect(findContact(text)).toMatchObject({ kind: 'messenger' })
    })

    it('a messenger name alone (no number, no handle nearby) passes', () => {
      expect(findContact('nao uso whatsapp, so falo por aqui')).toBeNull()
    })

    it('a number more than 40 chars after the name passes', () => {
      const filler = 'a'.repeat(41)
      expect(findContact(`telegram ${filler} 4567`)).toBeNull()
    })
  })

  describe('accents and case', () => {
    it('strips accents before matching (whátsapp 4567 still hits)', () => {
      expect(findContact('me chama no whátsapp 4567')).toMatchObject({ kind: 'messenger' })
    })

    it('matches uppercase messenger names', () => {
      expect(findContact('ZAP 4567')).toMatchObject({ kind: 'messenger' })
    })
  })
})
