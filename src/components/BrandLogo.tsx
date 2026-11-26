export const brandLogoPath = '/menfesawi-logo.svg'

export function BrandLogo({ size = 80, decorative = false }: { size?: number; decorative?: boolean }) {
  // Serve the original SVG directly at every size, including Payload's graphics slots.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={brandLogoPath} width={size} height={size} alt={decorative ? '' : 'Menfesawi'} />
}

export function BrandIcon() {
  return <BrandLogo size={20} decorative />
}
