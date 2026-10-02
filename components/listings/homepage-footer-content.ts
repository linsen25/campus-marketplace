type InformationPanel = {
  title: string
  heading: string
  intro: string
  statusNote?: string
  items: Array<{ title: string; copy: string }>
}

export const panels: InformationPanel[] = [
  {
    title: 'Western',
    heading: 'Made for Western. Kept within Western.',
    intro:
      'Campus Marketplace is a private marketplace built around the Western community. Access requires a verified Western email, so browsing, listing, and connecting all happen inside the same campus network.',
    items: [
      {
        title: 'Western access only',
        copy: 'A verified Western email is required before entering the marketplace. Listings are not publicly browsable outside the Western community.',
      },
      {
        title: 'Made for student life',
        copy: 'Textbooks after finals. Furniture before a move. Tech, clothes, kitchen gear, and the things that change hands every semester. Campus Marketplace is designed around how student life actually moves.',
      },
      {
        title: 'Local by default',
        copy: 'Find things nearby, connect with people in the same university community, and make exchanges without turning every listing into a cross-city transaction.',
      },
    ],
  },
  {
    title: 'Trust',
    heading: 'Built around trust, not just listings.',
    intro:
      'Buying from someone nearby should feel clear and accountable. Campus Marketplace is being designed so both sides know what was agreed, what changed, and when an exchange is actually complete.',
    statusNote:
      'Some transaction protection features below are part of the planned marketplace experience and are not yet live.',
    items: [
      {
        title: 'Verified access',
        copy: 'Every person entering the marketplace starts with a verified Western email, creating a clearer boundary than an anonymous public marketplace.',
      },
      {
        title: 'Protected payments',
        copy: 'Planned protected payments will keep funds from being released immediately. Payment moves forward only after the exchange is confirmed and the protection period is complete.',
      },
      {
        title: 'Both sides confirm',
        copy: 'A transaction is not complete because one person says it is. Buyers and sellers both confirm the handoff or delivery before the exchange moves forward.',
      },
      {
        title: 'A record to return to',
        copy: 'Listing details, transaction updates, timestamps, condition information, and supporting photos can stay connected to the exchange so both sides have something concrete to refer back to.',
      },
    ],
  },
  {
    title: 'Exchange',
    heading: 'From listing to handoff, keep it simple.',
    intro:
      'Finding something is only the beginning. The marketplace is being designed around the full exchange — from the first message to the moment the item changes hands.',
    statusNote:
      'Messaging, shipping, meetup recommendations, and shared condition-photo records are planned and not yet live.',
    items: [
      {
        title: 'Find it nearby',
        copy: 'Browse items listed by people in the Western community and quickly see the price, condition, and details that matter.',
      },
      {
        title: 'Connect directly',
        copy: 'Ask questions, confirm details, and decide whether the item is right for you before arranging the exchange.',
      },
      {
        title: 'Choose how to exchange',
        copy: 'Meet at a recommended public campus location, agree on another location together, or use shipping when meeting in person is not practical.',
      },
      {
        title: 'Capture the condition',
        copy: 'Before a handoff or shipment, condition photos can help establish what is being exchanged and reduce ambiguity afterward.',
      },
    ],
  },
  {
    title: 'Safety',
    heading: 'A safer exchange starts before the meetup.',
    intro:
      'Good marketplace safety is not one warning at checkout. It comes from knowing who has access, keeping important details attached to the transaction, and giving both sides clearer ways to exchange.',
    items: [
      {
        title: 'Meet somewhere public',
        copy: 'When exchanging in person, use a busy public location when possible. Recommended campus meetup locations can make that choice easier.',
      },
      {
        title: 'Keep the agreement clear',
        copy: 'Confirm the item, price, condition, and exchange method before meeting or shipping so both sides are working from the same expectations.',
      },
      {
        title: 'Keep useful records',
        copy: 'Messages, listing details, timestamps, and transaction evidence can provide context if something needs to be reviewed later.',
      },
      {
        title: 'Use the platform flow',
        copy: 'As transaction tools are introduced, keeping the exchange inside Campus Marketplace will make protection and transaction records more useful.',
      },
    ],
  },
]

export const contactLinks: {
  email: string | null
  discord: string | null
  github: string | null
} = {
  // Configure here: insert the real public contact email.
  email: null,
  // Configure here: insert the real Discord username or https invite URL.
  discord: null,
  // Configure here: insert the personal GitHub profile URL (not the repository URL).
  github: null,
}
