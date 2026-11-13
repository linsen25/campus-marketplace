# Profiles and shops

Profiles derive from authenticated identities and use RLS for owner updates.
Public profile/listing projections expose only display-safe fields, including
the boolean UWO badge where appropriate. Avatar and private media operations
use a server-only role validated against the canonical project.

Public shop discovery RPCs are intentionally public where product pages require
them. Membership, applications, accounting, and mutations remain authenticated
RPC flows with role and state checks.
