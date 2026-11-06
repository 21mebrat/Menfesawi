/**
 * Safely escapes HTML special characters to prevent injection in emails.
 */
export function escapeHtml(str: unknown): string {
  if (typeof str !== 'string') return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export type HtmlWrapperProps = {
  previewText: string
  title: string
  contentHtml: string
  footerHtml?: string
  locale?: 'en' | 'am'
}

/**
 * Reusable, responsive table-based email wrapper with theme-consistent styling.
 * Designed for cross-client reliability (Gmail, Apple Mail, Outlook).
 */
export function renderEmailHtml({
  previewText,
  title,
  contentHtml,
  footerHtml = '',
  locale = 'en',
}: HtmlWrapperProps): string {
  const isAmharic = locale === 'am'
  const brandName = isAmharic ? 'የኢትዮጵያ ጉዞ ማስታወሻ' : 'Ethiopia Travel Journal'
  const tagline = isAmharic ? 'ታሪክ፣ ባህል እና የተፈጥሮ ውበት' : 'Culture, History & Scenic Wonder'

  return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${escapeHtml(title)}</title>
  <style>
    /* Reset & Client-Specific Styles */
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; display: block; max-width: 100%; }
    body { margin: 0; padding: 0; width: 100% !important; min-width: 100%; background-color: #f7f6f2; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }

    /* Responsive Utilities */
    @media only screen and (max-width: 600px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .content-padding { padding: 24px 20px !important; }
      .header-padding { padding: 28px 20px !important; }
      .mobile-button { width: 100% !important; text-align: center !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f7f6f2; color: #1c1917;">
  <!-- Hidden Preheader Preview Text -->
  <div style="display: none; max-height: 0px; overflow: hidden; mso-hide: all; font-size: 1px; line-height: 1px; max-width: 0px; opacity: 0;">
    ${escapeHtml(previewText)}
    &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f7f6f2; margin: 0; padding: 32px 0 48px 0;">
    <tr>
      <td align="center" style="padding: 0 16px;">
        <!-- Email Container Card -->
        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 600px; background-color: #ffffff; border: 1px solid #e7e5e4; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          
          <!-- Brand Header -->
          <tr>
            <td class="header-padding" align="center" style="padding: 36px 32px 24px 32px; background-color: #1c1917; color: #fafaf9; text-align: center;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center">
                    <span style="display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: #d97706; margin-bottom: 6px;">
                      ETHIOPIA
                    </span>
                    <h1 style="margin: 0; font-family: Georgia, serif; font-size: 26px; line-height: 32px; font-weight: 700; color: #fafaf9; letter-spacing: -0.02em;">
                      ${escapeHtml(brandName)}
                    </h1>
                    <p style="margin: 6px 0 0 0; font-size: 13px; color: #a8a29e; letter-spacing: 0.05em;">
                      ${escapeHtml(tagline)}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content Area -->
          <tr>
            <td class="content-padding" style="padding: 36px 36px 28px 36px; background-color: #ffffff; color: #1c1917; font-size: 16px; line-height: 26px;">
              ${contentHtml}
            </td>
          </tr>

          <!-- Footer Area -->
          <tr>
            <td style="padding: 24px 36px 36px 36px; background-color: #fafaf9; border-top: 1px solid #f5f5f4; text-align: center; font-size: 12px; line-height: 20px; color: #78716c;">
              ${footerHtml}
              <p style="margin: 16px 0 0 0; font-size: 11px; color: #a8a29e;">
                &copy; ${new Date().getFullYear()} ${escapeHtml(brandName)}. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
