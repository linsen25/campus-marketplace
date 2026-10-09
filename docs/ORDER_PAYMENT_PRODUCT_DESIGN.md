# Order / Payment product design

Recorded 2026-10-09 from the owner's already-discussed concepts. This document
separates current directions from unresolved decisions; it is not implementation
authorization. See [project handoff](PROJECT_HANDOFF.md) for the existing baseline.

## 1. STATUS

**PRODUCT DESIGN IN PROGRESS. NOT IMPLEMENTED.**

- NO PAYMENT PROVIDER SELECTED.
- NO PAYMENT SCHEMA CREATED.
- NO PAYMENT MIGRATION.
- NO PAYMENT API.
- NO LIVE MONEY.

Existing listings, Favorites and TEXT/IMAGE/Realtime Messages remain the implemented
baseline. Profile/payment-looking demo UI does not establish a transaction system.

## 2. CORE PRODUCT MODEL DISCUSSED

| Concept | Product role |
| --- | --- |
| Listing | The item being sold |
| Messages | Communication, negotiation and transaction-request initiation |
| Order | The official confirmed transaction record |
| Payment | Money movement/status attached to an official Order |

Keep these distinct. Chat history is not the Order ledger; a listing's displayed
price/status is not authoritative payment evidence.

## 3. NO CART FOR THE INITIAL VERSION

Current direction: do not start with a traditional multi-item shopping cart.
Second-hand campus listings commonly represent one unique item. The initial
problem is **which Buyer obtains that listing**, rather than which SKU quantities
belong to a cart. Reconsider a cart if multi-quantity/retail inventory becomes a
product requirement. This direction is not an immutable technical law.

## 4. LISTING ENTRY POINT

A listing should have a transaction/order entry point alongside messaging:

Listing → transaction action → existing/new Buyer/Seller conversation → Order Request.

Button wording (for example, Start Order) is **NOT FINALIZED**. Neither direct
purchase mechanics nor conversation-creation timing is settled by this sketch.

## 5. MESSAGES "+" MENU

The current composer + opens attachments. The discussed future menu may contain
Attachment/Photo and Create Order/Order Request. The Order action should create
a platform/system transaction card, not a normal user-written URL. This menu and
new card are future work; no message type or database representation is chosen.

## 6. ORDER REQUEST CARD

Concept: a participant initiates a structured request in the conversation. Who
may initiate it is still open. A conceptual card could show:

- Order Request
- Listing title
- Agreed price
- Decline / Confirm

The card must look and behave differently from ordinary text. A text message
containing a payment link must **not** become an official Marketplace order/payment
action. Trusted system UI supplies official actions. Exact controls and counteroffer
behavior remain unresolved.

## 7. WHEN AN OFFICIAL ORDER EXISTS

Discussed rule: before both parties confirm, there is only an Order Request/pending
deal. After the other party confirms the request, create the official Order.
Only confirmed official Orders belong in the persistent Orders area. Initiating
the request and the receiver's confirmation represent the conceptual agreement;
the exact confirmation UX and persistence mechanism are not designed yet.

## 8. ORDERS AREA

There should be a persistent Orders section with Buying and Selling views.
An Order remains accessible independently of chat history and understandable if
the listing becomes sold, is deleted where allowed, the chat grows long or the
user returns months later. Messages is communication, Listing is the item and
Order is the transaction record. Navigation placement and tabs versus separate
Purchases/Sales pages remain open.

## 9. ORDER DETAIL CONCEPT

Possible detail content includes listing snapshot/title, agreed price/currency,
Buyer, Seller, Order status, Payment status, created time, paid time where applicable,
and an action back to Messages. Exact UI and status labels are **NOT FINALIZED**.

## 10. PRICE NEGOTIATION

The concept supports negotiation in Messages. For example, a listing is $100,
the parties agree to $80, an Order Request uses $80 and the receiver confirms it.
The official Order records $80 as the agreed transaction price. Snapshot commercial
terms: later listing-price changes must not silently rewrite an existing Order.
This example does not select a currency scope or payment provider.

## 11. DIRECT LISTING PURCHASE VS NEGOTIATED ORDER

**UNRESOLVED.** A direct Listing transaction action, chat negotiation and a possible
future Buy Now path were discussed. Exact first-version behavior is not settled.
Do not present Buy Now as an accepted final requirement.

## 12. PAYMENT LOCATION

Current direction: Payment attaches to an official confirmed Order, not a random
link in chat. Messages may show a trusted system card such as Order confirmed
with Pay/View Order actions. Orders remains the authoritative transaction-state
area. Payment timing and whether all Orders require online payment are open.

## 13. SAFETY PRINCIPLES ALREADY DISCUSSED

- Official payment actions are distinguishable from ordinary user messages.
- Browser/user text does not determine payment success.
- Official transaction history persists outside ordinary chat bubbles.
- Each Order snapshots the agreed price/terms.
- One unique listing must not be successfully sold to multiple Buyers.
- A future implementation must not store raw card numbers or CVC.
- Payment success eventually requires trusted provider/server confirmation, not
  only a client redirect.

These are product/security principles, not a provider API, locking strategy,
escrow promise or schema design.

## 14. IMPORTANT OPEN PRODUCT QUESTIONS

1. Who can create an Order Request: Buyer, Seller or both?
2. Does the receiver simply Confirm/Decline?
3. Can either party edit/counter the price instead of declining?
4. Does confirmation immediately reserve the listing?
5. Can multiple Buyers have pending requests for one listing?
6. When does a listing become AVAILABLE, RESERVED or SOLD? Current implemented
   listing statuses are only available/sold; RESERVED is a design question.
7. Is there a reservation expiry?
8. Does the initial version include Buy Now?
9. Must every Order use online payment, or can offline/cash completion exist?
10. When does the Seller receive money?
11. Is there a hold/escrow concept, or immediate completion? Neither is promised.
12. Is there a Confirm handoff/received item step?
13. How are cancellations handled before payment?
14. How are refunds handled after payment?
15. Is Orders a new main navigation item?
16. One Orders page with Buying/Selling tabs, or separate Purchases/Sales pages?
17. What system cards appear for request sent, confirmed, payment pending, paid,
    cancelled and completed? These are candidate situations, not a final enum.
18. Should confirmed Order creation find/create a conversation if none exists?
19. What happens if the listing is deleted or the Seller account changes after
    an Order exists?
20. What currency scope should the first version support? Current listings use
    CAD, but that does not settle future Order/Payment scope.

## 15. NEXT DESIGN STEP

Continue **PRODUCT DESIGN FIRST**:

1. Finalize Order Request UX.
2. Finalize Order lifecycle/statuses.
3. Finalize Listing AVAILABLE/RESERVED/SOLD behavior.
4. Finalize payment timing and seller payout model.
5. Finalize Orders UI.
6. Only then evaluate payment providers.
7. Only then design database/API/migrations.

Do not immediately select Stripe or another provider, author payment migrations,
implement Order cards, move money or deploy. No implementation was performed
while creating this document.
