/** Provider content is transient; this reference contains no raw response or coordinates. */
export type MeetingPlaceReference = { provider: 'google'; placeId: string }
/** Label is the final user-confirmed input text; provider metadata is auxiliary. */
export type MeetingLocation = Partial<MeetingPlaceReference> & { label: string }
/** The seller's chosen category for a formally selected meeting place. */
export type MeetingArea = 'ON_CAMPUS' | 'OTHER'
export type PlaceSuggestion = {
  placeId: string
  primaryText: string
  secondaryText: string
  displayText: string
}
export type PlaceDetails = {
  placeId: string
  displayName: string
  formattedAddress: string
}
