const fs = require('node:fs')
const path = require('node:path')

const file = path.resolve('.env.uu.local')
const env = Object.fromEntries(
  fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=')
      return [
        line.slice(0, index),
        line
          .slice(index + 1)
          .trim()
          .replace(/^['"]|['"]$/g, ''),
      ]
    })
)

async function main() {
  const key = env.GOOGLE_PLACES_API_KEY

  if (!key) {
    console.log('GOOGLE_PLACES_API_KEY: MISSING')
    return
  }

  const response = await fetch(
    'https://places.googleapis.com/v1/places:autocomplete',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'suggestions.placePrediction.placeId',
      },
      body: JSON.stringify({
        input: 'Weldon Library',
        includedRegionCodes: ['ca'],
      }),
    }
  )

  const data = await response.json()

  console.log('HTTP:', response.status)
  console.log('Google status:', data.error?.status || 'OK')
  console.log('Suggestions:', data.suggestions?.length ?? 0)
  console.log('Error message:', data.error?.message || 'None')
}

main().catch((error) => {
  console.error('Network error:', error.cause?.code || error.message)
  process.exitCode = 1
})
