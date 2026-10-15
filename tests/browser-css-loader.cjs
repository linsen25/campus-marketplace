// Offline fixture loader: preserve real CSS Modules composition and global styles.
const path = require('node:path')
const postcss = require('postcss')
const parse = require('postcss-selector-parser')

module.exports = function browserCss(source) {
  const names = {}
  const prefix = this.resourcePath.includes('.module.')
    ? path.basename(this.resourcePath).replace(/[^a-zA-Z0-9]/g, '_') + '_'
    : ''
  const tree = postcss.parse(source)
  tree.walkRules((rule) => {
    rule.selector = parse((ast) => {
      ast.walkClasses((node) => {
        let parent = node.parent
        let global = false
        while (parent) {
          if (parent.type === 'pseudo' && parent.value === ':global')
            global = true
          parent = parent.parent
        }
        if (!global) {
          const original = node.value
          names[original] = prefix + original
          node.value = names[original]
        }
      })
      ast.walkPseudos((node) => {
        if (node.value === ':global') node.replaceWith(...node.nodes[0].nodes)
      })
    }).processSync(rule.selector)
  })
  const imports = []
  const composed = new Map()
  tree.walkDecls('composes', (declaration) => {
    const local = Object.keys(names).find((name) =>
      declaration.parent.selector.includes('.' + names[name])
    )
    const match = declaration.value.match(
      /^([\w\s-]+?)(?:\s+from\s+(['"])(.+)\2)?$/
    )
    if (!local || !match) throw new Error('Unsupported fixture CSS composition')
    const classes = match[1].trim().split(/\s+/)
    if (match[3]) {
      const alias = 'composed' + imports.length
      imports.push(`import ${alias} from ${JSON.stringify(match[3])};`)
      composed.set(
        local,
        classes.map((name) => `${alias}[${JSON.stringify(name)}]`)
      )
    } else composed.set(local, classes)
    declaration.remove()
  })
  const expression = (name, seen = []) => {
    if (seen.includes(name)) throw new Error('Circular fixture CSS composition')
    const extra = composed.get(name) || []
    return [
      JSON.stringify(names[name]),
      ...extra.map((value) =>
        value.startsWith('composed')
          ? value
          : expression(value, [...seen, name])
      ),
    ].join(' + " " + ')
  }
  const exports = Object.keys(names).map(
    (name) => JSON.stringify(name) + ':' + expression(name)
  )
  return (
    imports.join('\n') +
    ';const style=document.createElement("style");style.textContent=' +
    JSON.stringify(tree.toString()) +
    ';document.head.appendChild(style);export default {' +
    exports.join(',') +
    '};'
  )
}
