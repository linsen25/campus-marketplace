#!/usr/bin/env node
/* Sync UU's checked-in Resend templates by alias. No secrets are read or stored. */
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const directory = path.join(root, 'emails', 'resend')
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'templates.json'), 'utf8'))
const cli = process.platform === 'win32'
  ? path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'resend-cli', 'dist', 'cli.cjs')
  : 'resend'

function run(args) {
  const values = [...args, '--json']
  const output = execFileSync(
    process.platform === 'win32' ? process.execPath : cli,
    process.platform === 'win32' ? [cli, ...values] : values,
    {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
  return JSON.parse(output)
}
function file(name) { return path.join(directory, name) }

const existing = run(['templates', 'list']).data || []
for (const template of manifest.templates) {
  const found = existing.find((entry) => entry.alias === template.alias)
  const common = ['--name', template.name, '--subject', template.subject, '--from', manifest.configuration.from, '--html-file', file(template.html), '--text-file', file(template.text), '--alias', template.alias, ...template.variables.flatMap((variable) => ['--var', variable])]
  const result = found ? run(['templates', 'update', found.id, ...common]) : run(['templates', 'create', ...common])
  const id = found ? found.id : result.id
  run(['templates', 'publish', id])
  const verified = run(['templates', 'get', id])
  if (verified.alias !== template.alias || verified.status !== 'published') throw new Error(`Template ${template.alias} was not published as expected.`)
  process.stdout.write(`${template.alias}\t${id}\tpublished\n`)
}
