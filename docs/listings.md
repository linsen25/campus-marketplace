# Listings and images

Verified users create and manage their own listings through existing UI V1
forms. Server/API validation bounds text, prices, categories, media metadata,
and same-origin writes. Listing image paths are allocated and checked by the
database/storage contract; client input cannot select arbitrary storage paths.

Public discovery uses safe projections. Private management and media mutation
require the owning authenticated user; RLS prevents cross-user writes.
