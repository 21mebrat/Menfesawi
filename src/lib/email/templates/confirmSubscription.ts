import { escapeHtml, renderEmailHtml } from './htmlWrapper'

export type ConfirmEmailParams = {
  confirmationUrl: string
  locale?: 'en' | 'am'
  expiresInHours?: number
}

export function buildConfirmSubscriptionEmail({
  confirmationUrl,
  locale = 'en',
  expiresInHours = 48,
}: ConfirmEmailParams): { subject: string; html: string; text: string } {
  const isAmharic = locale === 'am'

  const subject = isAmharic
    ? 'እባክዎ የኢትዮጵያ ጉዞ ማስታወሻ ምዝገባዎን ያረጋግጡ'
    : 'Confirm your subscription to Ethiopia Travel Journal'

  const previewText = isAmharic
    ? 'የዜና መጽሔት ምዝገባዎን ለማጠናቀቅ እባክዎ አገናኙን ይጫኑ።'
    : 'Please confirm your email address to receive our latest travel stories.'

  const heading = isAmharic ? 'የኢሜይል አድራሻዎን ያረጋግጡ' : 'Confirm Your Email Address'

  const body1 = isAmharic
    ? 'የኢትዮጵያ ጉዞ ማስታወሻ የዜና መጽሔትን ለመቀላቀል ስለጠየቁ እናመሰግናለን። የኢትዮጵያን ጥንታዊ ታሪክ፣ አስደናቂ ተፈጥሮ እና የበለጸገ ባህል የሚያሳዩ ጽሑፎችን ለማግኘት እባክዎ ከታች ያለውን አዝራር በመጫን ምዝገባዎን ያረጋግጡ።'
    : 'Thank you for requesting to join the Ethiopia Travel Journal newsletter. To start receiving curated travel essays, historical deep dives, and cultural narratives, please click the button below to confirm your address.'

  const buttonText = isAmharic ? 'ምዝገባዬን አረጋግጥ' : 'Confirm My Subscription'

  const expirationNotice = isAmharic
    ? `ይህ የማረጋገጫ አገናኝ ለ${expiresInHours} ሰዓታት ብቻ ያገለግላል። እርስዎ ካልጠየቁ ይህንን መልእክት ችላ ይበሉት።`
    : `This confirmation link will expire in ${expiresInHours} hours. If you did not request this subscription, you can safely ignore this email.`

  const fallbackNotice = isAmharic
    ? 'አዝራሩ ካልሰራ፣ የሚከተለውን አገናኝ ገልብጠው በአሳሽዎ ውስጥ ይክፈቱት፡'
    : "If the button doesn't work, copy and paste this URL into your browser:"

  const contentHtml = `
    <h2 style="margin: 0 0 16px 0; font-family: Georgia, serif; font-size: 22px; line-height: 28px; color: #1c1917;">
      ${escapeHtml(heading)}
    </h2>
    <p style="margin: 0 0 24px 0; color: #44403c; line-height: 26px;">
      ${escapeHtml(body1)}
    </p>

    <!-- Call to Action Button -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 32px 0;">
      <tr>
        <td align="center" style="background-color: #c2410c; border-radius: 6px;">
          <a href="${escapeHtml(confirmationUrl)}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 14px 28px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 6px; letter-spacing: 0.02em;">
            ${escapeHtml(buttonText)}
          </a>
        </td>
      </tr>
    </table>

    <p style="margin: 28px 0 12px 0; font-size: 13px; color: #78716c; line-height: 20px;">
      ${escapeHtml(expirationNotice)}
    </p>

    <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #e7e5e4; font-size: 12px; color: #78716c; word-break: break-all;">
      <p style="margin: 0 0 6px 0;">${escapeHtml(fallbackNotice)}</p>
      <a href="${escapeHtml(confirmationUrl)}" style="color: #c2410c; text-decoration: underline;">
        ${escapeHtml(confirmationUrl)}
      </a>
    </div>
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

ምዝገባዎን ለማረጋገጥ የሚከተለውን አገናኝ ይክፈቱ፡
${confirmationUrl}

${expirationNotice}

© ${new Date().getFullYear()} የኢትዮጵያ ጉዞ ማስታወሻ`
    : `Ethiopia Travel Journal
========================================

${heading}

${body1}

Confirm your subscription by visiting the link below:
${confirmationUrl}

${expirationNotice}

© ${new Date().getFullYear()} Ethiopia Travel Journal`

  return { subject, html, text }
}
