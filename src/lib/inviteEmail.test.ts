import { describe, expect, it } from 'vitest'
import { buildInviteEmail } from './inviteEmail'

describe('invitation email content', () => {
  it('provides Parent B with the complete joining path without putting the code in the URL', () => {
    const email = buildInviteEmail('7K3QP', '2026-07-13T18:00:00.000Z', 'https://babylog.example.com', 'Adam')

    expect(email.subject).toBe('Adam invited you to join Baby Log')
    expect(email.text).toContain("Adam invited you to join your family's private space in Baby Log.")
    expect(email.text).toContain('Open https://babylog.example.com in Safari or Chrome.')
    expect(email.text).toContain('Select “Join a family — Parent B”.')
    expect(email.text).toContain('Use the same email address where you received this invitation.')
    expect(email.text).toContain('Enter the family code: 7K3QP')
    expect(email.text).toContain('Select “Join family” to finish.')
    expect(email.text).toContain('ask Adam to generate a new one from Settings.')
    expect(email.text).not.toContain('ask Parent A')
    expect(email.html).toContain('>7K3QP<')
    expect(email.html).not.toContain('babylog.example.com?')
  })

  it('escapes the verified parent name before adding it to HTML', () => {
    const email = buildInviteEmail(
      '7K3QP',
      '2026-07-13T18:00:00.000Z',
      'https://babylog.example.com',
      'Adam <script>alert(1)</script>',
    )

    expect(email.text).toContain('Adam <script>alert(1)</script> invited you')
    expect(email.html).toContain('Adam &lt;script&gt;alert(1)&lt;/script&gt; invited you')
    expect(email.html).not.toContain('<script>')
  })
})
