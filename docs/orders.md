# Offers, orders, and fulfillment

Formal offers, counters, acceptance, agreement, fulfillment, cancellation, and
order workspaces use existing UI V1 components and server/RPC state. The unified
environment enables them only for the canonical project. Fulfillment retains
participant and verified-user authorization; Direct, Interac, delivery, and
cancellation rules are not relaxed by environment wiring.

Order snapshot media is server-only storage work with manifest, hash, lease,
and participant checks. It does not use a browser service credential.
