// Stop a local B32 Next.js process by port without touching unrelated processes.
const { execFileSync } = require('node:child_process')
const port = process.argv[2] || '3021'
if (!/^\d{2,5}$/.test(port)) throw new Error('Invalid port.')
let output = ''
try {
  output = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`,
    ],
    { encoding: 'utf8' }
  )
} catch (error) {
  if (error.status !== 1) throw error
}
let pids = output.split(/\r?\n/).map(Number).filter(Boolean)
if (!pids.length) {
  try {
    const netstat = execFileSync('netstat.exe', ['-ano'], { encoding: 'utf8' })
    const pattern = new RegExp(
      `:${port}\\s+[^\\r\\n]+LISTENING\\s+(\\d+)`,
      'gi'
    )
    pids = [...netstat.matchAll(pattern)].map((match) => Number(match[1]))
  } catch (error) {
    if (error.status !== 1) throw error
  }
}
for (const pid of pids) {
  try {
    const command = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
      ],
      { encoding: 'utf8' }
    ).trim()
    const commandPattern = new RegExp(
      `(dev-b32|next(?:\\\\|/)dist[/\\\\]bin[/\\\\]next).*(-p|--port)\\s*=?\\s*${port}`,
      'i'
    )
    if (!commandPattern.test(command))
      throw new Error(`Refusing to stop non-B32 process on port ${port}.`)
    execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'])
  } catch (error) {
    // WMI/CIM inspection is denied in some managed Windows sessions. Never
    // guess ownership from a PID; leave the listener untouched and report it.
    if (error.status !== 1)
      console.warn(`unable to verify PID ${pid}; refusing to stop it safely`)
  }
}
console.log(pids.length ? `processed ${pids.length} listener candidate(s)` : 'no B32 listener found')
