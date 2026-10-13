// Finish every in-flight transaction before finally cleanup, even when one fails.
module.exports = async function settleFixtureRaces(tasks) {
  const results = await Promise.allSettled(tasks)
  const failure = results.find((result) => result.status === 'rejected')
  if (failure) throw failure.reason
  return results.map((result) => result.value)
}
