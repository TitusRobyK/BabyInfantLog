export interface InviteEmailContent {
  subject: string
  text: string
  html: string
}

function emailDisplayName(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 60) || 'A family member'
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function buildInviteEmail(code: string, expiresAt: string, appUrl: string, inviterName: string): InviteEmailContent {
  const inviter = emailDisplayName(inviterName)
  const htmlInviter = escapeHtml(inviter)
  const htmlAppUrl = escapeHtml(appUrl)
  const expiry = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(expiresAt))
  const text = [
    'Hi,',
    '',
    `${inviter} invited you to join your family's private space in Baby Log. Once connected, you can both record and view the baby's daily care entries.`,
    '',
    'To join the family:',
    `1. Open ${appUrl} in Safari or Chrome.`,
    '2. Select “Join a family — Parent B”.',
    '3. Continue with Google, or create/log in with email and password.',
    '4. Use the same email address where you received this invitation.',
    `5. Enter the family code: ${code}`,
    '6. Review the family confirmation shown by Baby Log.',
    '7. Select “Join family” to finish.',
    '',
    `This code expires ${expiry} and can only be used once.`,
    `If the code does not work, ask ${inviter} to generate a new one from Settings.`,
    'If you were not expecting this invitation, you can safely ignore this email.',
  ].join('\n')
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.55;color:#161616;max-width:600px">
      <p>Hi,</p>
      <p>${htmlInviter} invited you to join your family's private space in Baby Log. Once connected, you can both record and view the baby's daily care entries.</p>
      <p><strong>To join the family:</strong></p>
      <ol>
        <li>Open <a href="${htmlAppUrl}">${htmlAppUrl}</a> in Safari or Chrome.</li>
        <li>Select <strong>Join a family — Parent B</strong>.</li>
        <li>Continue with Google, or create/log in with email and password.</li>
        <li>Use the same email address where you received this invitation.</li>
        <li>Enter the family code shown below.</li>
        <li>Review the family confirmation shown by Baby Log.</li>
        <li>Select <strong>Join family</strong> to finish.</li>
      </ol>
      <p style="font-size:32px;font-weight:800;letter-spacing:0.14em;margin:24px 0">${code}</p>
      <p>This code expires ${expiry} and can only be used once.</p>
      <p>If the code does not work, ask ${htmlInviter} to generate a new one from Settings.</p>
      <p>If you were not expecting this invitation, you can safely ignore this email.</p>
    </div>
  `.trim()

  return { subject: `${inviter} invited you to join Baby Log`, text, html }
}
