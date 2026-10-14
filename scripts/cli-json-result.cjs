// Extract one complete JSON result without consuming trailing CLI notices.
// Fixes CLI result parsing; malformed JSON and unexpected rows still fail.
function parseRows(stdout) {
  const start = stdout.indexOf('{')
  if (start < 0) throw Error('CLI JSON result: no object found')
  const stack = []
  let inString = false,
    escaped = false
  for (let i = start; i < stdout.length; i++) {
    const char = stdout[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{' || char === '[') stack.push(char)
    else if (char === '}' || char === ']') {
      if (stack.pop() !== (char === '}' ? '{' : '['))
        throw Error('CLI JSON result: mismatched delimiters')
      if (!stack.length) {
        let payload
        try {
          payload = JSON.parse(stdout.slice(start, i + 1))
        } catch {
          // Do not include payload fragments, which may contain private SQL rows.
          throw Error('CLI JSON result: malformed object')
        }
        if (!Array.isArray(payload.rows))
          throw Error('CLI JSON result: expected rows array')
        return payload.rows
      }
    }
  }
  throw Error('CLI JSON result: incomplete object')
}
module.exports = { parseRows }
