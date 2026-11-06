import { escapeHtml, renderEmailHtml } from './htmlWrapper'

export type ArticleEmailParams = {
  title: string
  excerpt?: string
  articleUrl: string
  heroImageUrl?: string
  heroImageAlt?: string
  authorName?: string
  publishedDate?: string
  readingTimeMinutes?: number
  unsubscribeUrl: string
  locale?: 'en' | 'am'
}

export function buildArticlePublishedEmail({
  title,
  excerpt = '',
  articleUrl,
  heroImageUrl,
  heroImageAlt = '',
  authorName,
  publishedDate,
  readingTimeMinutes,
  unsubscribeUrl,
  locale = 'en',
}: ArticleEmailParams): { subject: string; html: string; text: string } {
  const isAmharic = locale === 'am'

  const subject = isAmharic
    ? `አዲስ ታሪክ፡ ${title}`
    : `New Story: ${title}`

  const previewText = excerpt
    ? (excerpt.length > 120 ? `${excerpt.substring(0, 117)}...` : excerpt)
    : (isAmharic ? 'አዲስ የጉዞ ታሪክ በድረ-ገጻችን ላይ ታትሟል።' : 'A new travel story has just been published on Ethiopia Travel Journal.')

  const ctaText = isAmharic ? 'ሙሉውን ጽሑፍ አንብብ' : 'Read Full Story'
  const newStoryBadge = isAmharic ? 'አዲስ የጉዞ ታሪክ' : 'NEW TRAVEL STORY'
  const unsubscribeNotice = isAmharic
    ? 'ይህ መልእክት የተላከው ለኢትዮጵያ ጉዞ ማስታወሻ የዜና መጽሔት ስለተመዘገቡ ነው።'
    : 'You received this email because you are subscribed to Ethiopia Travel Journal.'
  const unsubscribeLinkText = isAmharic ? 'ከዝርዝሩ ውጣ (Unsubscribe)' : 'Unsubscribe from this list'

  // Metadata row (Author, Date, Reading Time)
  const metaParts: string[] = []
  if (authorName) metaParts.push(escapeHtml(authorName))
  if (publishedDate) metaParts.push(escapeHtml(publishedDate))
  if (readingTimeMinutes) {
    metaParts.push(
      isAmharic
        ? `የንባብ ጊዜ፡ ${readingTimeMinutes} ደቂቃ`
        : `${readingTimeMinutes} min read`,
    )
  }
  const metaRow = metaParts.length > 0 ? metaParts.join(' &bull; ') : ''

  // Hero image block (if provided)
  let heroImageBlock = ''
  if (heroImageUrl) {
    heroImageBlock = `
      <div style="margin: 0 0 24px 0; border-radius: 8px; overflow: hidden; background-color: #e7e5e4;">
        <a href="${escapeHtml(articleUrl)}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; display: block;">
          <img src="${escapeHtml(heroImageUrl)}" alt="${escapeHtml(heroImageAlt || title)}" width="528" style="width: 100%; max-width: 528px; height: auto; display: block; border-radius: 8px; object-fit: cover;" />
        </a>
      </div>
    `
  }

  const contentHtml = `
    <!-- Top Category / Badge -->
    <div style="margin: 0 0 12px 0;">
      <span style="display: inline-block; padding: 4px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #c2410c; background-color: #ffedd5; border-radius: 4px;">
        ${escapeHtml(newStoryBadge)}
      </span>
    </div>

    <!-- Article Headline -->
    <h2 style="margin: 0 0 12px 0; font-family: Georgia, serif; font-size: 26px; line-height: 34px; font-weight: 700; color: #1c1917; letter-spacing: -0.01em;">
      <a href="${escapeHtml(articleUrl)}" style="color: #1c1917; text-decoration: none;">
        ${escapeHtml(title)}
      </a>
    </h2>

    ${metaRow ? `<p style="margin: 0 0 20px 0; font-size: 13px; color: #78716c; line-height: 18px;">${metaRow}</p>` : ''}

    ${heroImageBlock}

    <!-- Excerpt / Summary -->
    ${
      excerpt
        ? `<p style="margin: 0 0 28px 0; font-size: 16px; line-height: 26px; color: #44403c; font-family: Georgia, serif; font-style: italic;">
            &ldquo;${escapeHtml(excerpt)}&rdquo;
          </p>`
        : ''
    }

    <!-- Call to Action Button -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 28px 0 12px 0;">
      <tr>
        <td align="center" style="background-color: #1c1917; border-radius: 6px;">
          <a href="${escapeHtml(articleUrl)}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 14px 30px; font-size: 15px; font-weight: 600; color: #fafaf9; text-decoration: none; border-radius: 6px; letter-spacing: 0.02em;">
            ${escapeHtml(ctaText)} &rarr;
          </a>
        </td>
      </tr>
    </table>
  `

  const footerHtml = `
    <p style="margin: 0 0 8px 0; color: #78716c;">
      ${escapeHtml(unsubscribeNotice)}
    </p>
    <p style="margin: 0;">
      <a href="${escapeHtml(unsubscribeUrl)}" style="color: #a8a29e; text-decoration: underline;">
        ${escapeHtml(unsubscribeLinkText)}
      </a>
    </p>
  `

  const html = renderEmailHtml({
    previewText,
    title: subject,
    contentHtml,
    footerHtml,
    locale,
  })

  const textMeta = metaParts.length > 0 ? `\n${metaParts.join(' | ')}\n` : ''

  const text = isAmharic
    ? `የኢትዮጵያ ጉዞ ማስታወሻ (Ethiopia Travel Journal)
========================================

${newStoryBadge}
${title}
${textMeta}

${excerpt ? `"${excerpt}"\n\n` : ''}ጽሑፉን በድረ-ገጻችን ላይ ለማንበብ የሚከተለውን አገናኝ ይጫኑ፡
${articleUrl}

----------------------------------------
${unsubscribeNotice}
ከዝርዝሩ ለመውጣት ይህንን አገናኝ ይክፈቱ፡
${unsubscribeUrl}

© ${new Date().getFullYear()} የኢትዮጵያ ጉዞ ማስታወሻ`
    : `Ethiopia Travel Journal
========================================

${newStoryBadge}
${title}
${textMeta}

${excerpt ? `"${excerpt}"\n\n` : ''}Read the full story online:
${articleUrl}

----------------------------------------
${unsubscribeNotice}
To unsubscribe, please visit:
${unsubscribeUrl}

© ${new Date().getFullYear()} Ethiopia Travel Journal`

  return { subject, html, text }
}
