// The public stylesheet also includes Tailwind preflight. Import only its token
// declarations into Payload, with the dark selector driven by Payload's SSR theme.
const fs = require('node:fs')
const path = require('node:path')
const postcss = require('postcss')

module.exports = () => ({
  postcssPlugin: 'menfesawi-admin-tokens',
  Once(root, { result }) {
    root.walkAtRules('menfesawi-admin-tokens', (marker) => {
      const file = path.resolve(__dirname, '../src/app/global.css')
      const theme = postcss.parse(fs.readFileSync(file, 'utf8'), { from: file })
      result.messages.push({
        type: 'dependency',
        plugin: 'menfesawi-admin-tokens',
        file,
        parent: root.source.input.file,
      })
      for (const [selector, target] of [
        [':root', 'html[data-theme]'],
        ['.dark', 'html[data-theme="dark"]'],
      ]) {
        const rule = theme.nodes.find((node) => node.type === 'rule' && node.selector === selector)
        if (!rule) throw marker.error(`Missing ${selector} theme in global.css`)
        const tokens = postcss.rule({ selector: target })
        rule.walkDecls(/^--/, (declaration) => tokens.append(declaration.clone()))
        marker.before(tokens)
      }
      marker.remove()
    })
  },
})
module.exports.postcss = true
