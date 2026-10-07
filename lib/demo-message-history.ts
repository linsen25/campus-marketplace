import type { Conversation } from '@/components/client-card'
import type { Message } from '@/types/message'

export const DEMO_CURRENT_USER_ID = 'demo-owner'

/** Allocate a distinct history and message identities for each conversation. */
export function createDemoMessageHistory(
  conversation: Conversation
): Message[] {
  const title = conversation.listing.title
  const other = conversation.person.name.split(' ')[0]
  const entries: Array<[boolean, string]> = [
    [false, `Hi! Thanks for asking about the ${title}.`],
    [false, 'It is still available.'],
    [false, 'Happy to answer any questions before we arrange a pickup.'],
    [true, `Thanks, ${other}! It looks great.`],
    [true, 'Could we meet on campus?'],
    [
      true,
      'I have a class in the afternoon, but I can stop by the library afterward.',
    ],
    [false, 'Yes, the library works for me.'],
    [true, 'Perfect. What time would be convenient?'],
    [false, 'Around 4:30 would be good.'],
    [false, 'We can meet near the main entrance.'],
    [false, 'There is a covered area beside the doors if it rains.'],
    [true, 'That sounds good.'],
    [true, 'I will bring a bag.'],
    [
      true,
      'Just to confirm before I leave: I will be walking over from my afternoon class, so I might arrive a few minutes early. Please let me know if the meeting spot or time changes. I can wait near the main entrance and message when I get there.',
    ],
    [
      false,
      `No problem. I will bring the ${title} with me and make sure everything is ready for you to check before deciding.`,
    ],
    [true, 'Thanks for being flexible!'],
    [false, 'Of course.'],
    [false, 'You can take a look when we meet.'],
    [false, 'There is no rush.'],
    [true, 'Great, see you then.'],
    [true, 'I have saved the meeting location.'],
    [true, 'I will be there at 4:30.'],
    [false, 'See you soon!'],
    [true, `All set for the ${title} pickup, ${other}. Thank you!`],
  ]
  const latest = Date.parse(
    conversation.lastMessageAt ?? conversation.createdAt
  )
  return entries.map(([sent, content], index) => ({
    id: `${conversation.id}-message-${index}`,
    conversationId: conversation.id,
    senderId: sent ? DEMO_CURRENT_USER_ID : conversation.person.id,
    type: 'TEXT',
    content,
    createdAt: new Date(
      latest - (entries.length - index - 1) * 60000
    ).toISOString(),
  }))
}
