import path from 'node:path'

const config = {
  plugins: {
    [path.resolve('scripts/admin-tokens.cjs')]: {},
    '@tailwindcss/postcss': {},
  },
}

export default config
