import { escapeHtml, renderEmailHtml } from './htmlWrapper'

export type UnsubscribeConfirmationParams = {
  resubscribeUrl: string
  locale?: 'en' | 'am'
}

export function buildUnsubscribeConfirmationEmail({
  resubscribeUrl,
  locale = 'en',
}: UnsubscribeConfirmationParams): { subject: string; html: string; text: string } {
  const isAmharic = locale === 'am'

  const subject = isAmharic
    ? 'ከኢትዮጵያ ጉዞ ማስታወሻ የዜና መጽሔት ተሰርዘዋል'
    : 'You have been unsubscribed from Ethiopia Travel Journal'

  const previewText = isAmharic
    ? 'የዜና መጽሔት ምዝገባዎ በተሳካ ሁኔታ ተሰርዟል።'
    : 'Your newsletter subscription has been successfully cancelled.'

  const heading = isAmharic ? 'የምዝገባ መሰረዝ ማረጋገጫ' : 'Subscription Cancelled'

  const body1 = isAmharic
    ? 'ከኢትዮጵያ ጉዞ ማስታወሻ የኢሜይል ዝርዝር ውስጥ በተሳካ ሁኔታ ተሰርዘዋል። ከዚህ በኋላ አዳዲስ ታሪኮች ወይም መልእክቶች በኢሜይልዎ አይላኩም።'
    : 'You have been successfully removed from the Ethiopia Travel Journal mailing list. You will no longer receive story notifications or newsletters from us.'

  const body2 = isAmharic
    ? 'ይህ በስህተት የተደረገ ከሆነ በማንኛውም ጊዜ እንደገና መመዝገብ ይችላሉ።'
    : 'If this was done in error or you change your mind in the future, you are always welcome to resubscribe.'

  const buttonText = isAmharic ? 'እንደገና ተመዝገብ' : 'Resubscribe Anytime'

  const contentHtml = `
    <h2 style="margin: 0 0 16px 0; font-family: Georgia, serif; font-size: 22px; line-height: 28px; color: #1c1917;">
      ${escapeHtml(heading)}
    </h2>
    <p style="margin: 0 0 16px 0; color: #44403c; line-height: 26px;">
      ${escapeHtml(body1)}
    </p>
    <p style="margin: 0 0 24px 0; color: #78716c; line-height: 24px; font-size: 14px;">
      ${escapeHtml(body2)}
    </p>

    <!-- Call to Action Button -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
      <tr>
        <td align="center" style="background-color: #f5f5f4; border: 1px solid #d6d3d1; border-radius: 6px;">
          <a href="${escapeHtml(resubscribeUrl)}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 12px 24px; font-size: 14px; font-weight: 600; color: #1c1917; text-decoration: none; border-radius: 6px; letter-spacing: 0.02em;">
            ${escapeHtml(buttonText)}
          </a>
        </td>
      </tr>
    </table>
  `

  const html = renderEmailHtml({
    previewText,
    title: subject,
    contentHtml,
    locale,
  })

  const text = isAmharic
    ? `የኢትዮጵያ ጉዞ ማስታወሻ (Ethiopia Travel Journal)
========================================

${heading}

${body1}

${body2}

እንደገና ለመመዝገብ፡
${resubscribeUrl}

© ${new Date().getFullYear()} የኢትዮጵያ ጉዞ ማስታወሻ`
    : `Ethiopia Travel Journal
========================================

${heading}

${body1}

${body2}

To resubscribe at any time:
${resubscribeUrl}

© ${new Date().getFullYear()} Ethiopia Travel Journal`

  return { subject, html, text }
}
