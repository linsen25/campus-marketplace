// Deterministic local-time schedule rules, no network or accounts.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  ts = require('typescript')
const mod = { exports: {} }
new Function(
  'module',
  'exports',
  ts.transpileModule(fs.readFileSync('lib/order-schedule-preview.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
)(mod, mod.exports)
const p = mod.exports
const now = new Date(2026, 9, 9, 19, 20)
assert.equal(p.getEarliestOrderSchedule(now).getHours(), 20)
assert.equal(p.getEarliestOrderSchedule(now).getMinutes(), 30)
assert.equal(now.getHours(), 19)
for (const time of ['19:30', '20:00', '20:15', '20:22'])
  assert(
    !p.validateNewOrderSchedule({ mode: 'scheduled', date: now, time }, now)
      .valid
  )
for (const time of ['20:30', '20:45', '21:00'])
  assert(
    p.validateNewOrderSchedule({ mode: 'scheduled', date: now, time }, now)
      .valid
  )
assert(
  !p.validateNewOrderSchedule(
    { mode: 'scheduled', date: new Date(2026, 9, 8), time: '21:00' },
    now
  ).valid
)
assert(!p.validateNewOrderSchedule({ mode: 'scheduled', time: '' }, now).valid)
assert(
  !p.validateNewOrderSchedule(
    { mode: 'scheduled', date: now, time: '24:00' },
    now
  ).valid
)
assert(
  p.validateNewOrderSchedule(
    { mode: 'scheduled', date: p.addLocalDays(now, 30), time: '19:15' },
    now
  ).valid
)
assert(
  !p.validateNewOrderSchedule(
    { mode: 'scheduled', date: p.addLocalDays(now, 30), time: '19:30' },
    now
  ).valid
)
assert(
  !p.validateNewOrderSchedule(
    { mode: 'scheduled', date: p.addLocalDays(now, 31), time: '00:00' },
    now
  ).valid
)
assert(!p.validateNewOrderSchedule({ mode: 'tbd', time: '' }, now).valid)
const scheduledAt = new Date(2026, 9, 9, 20, 0).getTime()
const snapshot = { scheduleMode: 'scheduled', scheduledAt }
assert(p.canAcceptScheduledRequest(snapshot, new Date(2026, 9, 9, 19, 30)))
assert(!p.canAcceptScheduledRequest(snapshot, new Date(scheduledAt)))
assert(!p.canAcceptScheduledRequest(snapshot, new Date(scheduledAt + 1)))
assert(
  !p.validateOrderScheduleSnapshot(snapshot, new Date(2026, 9, 9, 19, 30)).valid
)
assert(!p.canAcceptScheduledRequest({ scheduleMode: 'tbd' }, now))
assert.equal(
  p.formatSchedule({
    scheduleMode: 'scheduled',
    scheduledAt: new Date(2026, 9, 12, 15, 0).getTime(),
  }),
  'Oct 12, 2026 \u00b7 3:00 PM'
)
assert.equal(p.formatSchedule({ scheduleMode: 'tbd' }), 'Schedule unavailable')
assert.equal(
  p.roundUpToMinuteStep(new Date(2026, 9, 9, 20, 30, 1)).getMinutes(),
  45
)
assert.equal(
  p.roundUpToMinuteStep(new Date(2026, 9, 9, 20, 30)).getMinutes(),
  30
)
assert(
  p.validateNewOrderSchedule(
    { mode: 'scheduled', date: new Date(2026, 9, 10), time: '02:00' },
    now
  ).valid
)
console.log(
  'PASS local +1h rounded up/15min/+30-day timestamp rules; same-day/late hours/reject schedule TBD; strict parsing; creation vs Accept expiry; formatting; no input mutation'
)

for (const [hour, minute, meridiem, canonical, display] of [
  [12, 0, 'AM', '00:00', '12:00 AM'],
  [12, 0, 'PM', '12:00', '12:00 PM'],
  [1, 0, 'AM', '01:00', '1:00 AM'],
  [1, 0, 'PM', '13:00', '1:00 PM'],
  [3, 15, 'PM', '15:15', '3:15 PM'],
  [9, 30, 'AM', '09:30', '9:30 AM'],
  [11, 45, 'PM', '23:45', '11:45 PM'],
]) {
  assert.equal(p.to24HourTime(hour, minute, meridiem), canonical)
  assert.deepEqual(p.from24HourTime(canonical), { hour, minute, meridiem })
  assert.equal(p.formatScheduleTime(canonical), display)
}
for (const value of ['24:00', '15:07', '15:22', '3:15', 'bad'])
  assert.equal(p.from24HourTime(value), null)
assert.deepEqual(p.seedOrderTimeWheel('', now, now), {
  hour: 8,
  minute: 30,
  meridiem: 'PM',
})
assert.deepEqual(p.seedOrderTimeWheel('', p.addLocalDays(now, 1), now), {
  hour: 7,
  minute: 30,
  meridiem: 'PM',
})
assert.deepEqual(p.seedOrderTimeWheel('20:15', now, now), {
  hour: 8,
  minute: 15,
  meridiem: 'PM',
})
for (const minute of [0, 15])
  assert(
    !p.validateNewOrderSchedule(
      { mode: 'scheduled', date: now, time: p.to24HourTime(8, minute, 'PM') },
      now
    ).valid
  )
for (const minute of [30, 45])
  assert(
    p.validateNewOrderSchedule(
      { mode: 'scheduled', date: now, time: p.to24HourTime(8, minute, 'PM') },
      now
    ).valid
  )
console.log(
  'PASS wheel 12h/24h/midnight/noon round trips; temporary seeds; no silently corrected existing value; +60min central validation'
)
