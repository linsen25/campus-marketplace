# Business V1 source index

Generated from the current local worktree on 2026-10-18. This is a source index, not a deployed schema assertion. Later ALTER/DROP, overloads and dynamic SQL must be reviewed; last CREATE OR REPLACE is a lookup aid only.

## Complete Pages Router inventory

| File | Kind | Direct server-module imports |
|---|---|---|
| pages/_app.tsx | Page/framework |  |
| pages/_document.tsx | Page/framework |  |
| pages/_offline.tsx | Page/framework |  |
| pages/api/auth/[action].ts | API | @/lib/server/auth-username, @/lib/server/marketplace-auth, @/lib/server/pending-signup |
| pages/api/favorites/[[...segments]].ts | API | @/lib/server/marketplace-auth, @/lib/server/supabase-listings-repository |
| pages/api/financial-capabilities/test-state.ts | API | @/lib/server/financial-capabilities-service, @/lib/server/marketplace-auth |
| pages/api/financial-capabilities.ts | API | @/lib/server/financial-capabilities-service |
| pages/api/listing-images/[id].ts | API | @/lib/server/marketplace-auth, @/lib/server/supabase-listings-repository |
| pages/api/listings/[[...segments]].ts | API | @/lib/server/marketplace-auth |
| pages/api/listings/view.ts | API | @/lib/server/financial-capabilities-service, @/lib/server/marketplace-auth, @/lib/server/messages-environment |
| pages/api/messages/conversations/[[...segments]].ts | API | @/lib/server/marketplace-auth, @/lib/server/supabase-messages-repository |
| pages/api/messages/image-upload/[submissionId]/[imageId].ts | API | @/lib/server/marketplace-auth, @/lib/server/message-image-service, @/lib/server/supabase-messages-repository |
| pages/api/messages/images/[[...segments]].ts | API | @/lib/server/chat-image-storage, @/lib/server/marketplace-auth, @/lib/server/message-image-service, @/lib/server/supabase-messages-repository |
| pages/api/messages/realtime-session.ts | API | @/lib/server/marketplace-auth, @/lib/server/messages-environment |
| pages/api/messages/withdraw.ts | API | @/lib/server/marketplace-auth, @/lib/server/supabase-messages-repository |
| pages/api/notification-preferences.ts | API | @/lib/server/financial-capabilities-service, @/lib/server/marketplace-auth |
| pages/api/notifications.ts | API | @/lib/server/marketplace-auth, @/lib/server/notifications-service |
| pages/api/offers/[[...segments]].ts | API | @/lib/server/marketplace-auth, @/lib/server/offers-service |
| pages/api/order-domain/[id]/[operation].ts | API | @/lib/server/handoff-error, @/lib/server/marketplace-auth, @/lib/server/order-domain-service |
| pages/api/order-requests/[[...segments]].ts | API | @/lib/server/marketplace-auth, @/lib/server/order-request-service, @/lib/server/orders-service |
| pages/api/orders/[[...segments]].ts | API | @/lib/server/marketplace-auth, @/lib/server/orders-service |
| pages/api/orders/[orderId]/simulate-payment-success.ts | API | @/lib/server/financial-capabilities-service, @/lib/server/marketplace-auth, @/lib/server/order-financial-service |
| pages/api/places/[action].ts | API | @/lib/server/marketplace-auth, @/lib/server/places-service |
| pages/api/profile/account.ts | API | @/lib/server/marketplace-auth |
| pages/api/profile/activity.ts | API | @/lib/server/financial-capabilities-service, @/lib/server/marketplace-auth |
| pages/api/profile/categories.ts | API | @/lib/server/marketplace-auth |
| pages/api/profile/username.ts | API | @/lib/server/auth-username, @/lib/server/marketplace-auth |
| pages/api/shop.ts | API | @/lib/server/marketplace-auth, @/lib/server/shop-profile-repository |
| pages/api/stripe/[action].ts | API | @/lib/server/marketplace-auth, @/lib/server/stripe-environment, @/lib/server/stripe-setup |
| pages/api/stripe/account-webhook.ts | API | @/lib/server/stripe-webhook-handler |
| pages/api/stripe/connect-refresh.ts | API | @/lib/server/marketplace-auth, @/lib/server/stripe-setup |
| pages/api/stripe/connect-webhook.ts | API | @/lib/server/stripe-webhook-handler |
| pages/api/stripe/webhook.ts | API | @/lib/server/stripe-webhook-handler |
| pages/api/stripe/worker.ts | API | @/lib/server/stripe-setup |
| pages/auth/sign-in.tsx | Page/framework |  |
| pages/home.tsx | Page/framework |  |
| pages/index.tsx | Page/framework |  |
| pages/kit/banners.tsx | Page/framework |  |
| pages/kit/buttons.tsx | Page/framework |  |
| pages/kit/chips.tsx | Page/framework |  |
| pages/listings/[id]/edit.tsx | Page/framework | @/lib/server/marketplace-auth |
| pages/listings/[id].tsx | Page/framework |  |
| pages/listings/index.tsx | Page/framework | @/lib/server/public-shop |
| pages/listings/new.tsx | Page/framework | @/lib/server/marketplace-auth |
| pages/profile/listings.tsx | Page/framework | @/lib/server/marketplace-auth |
| pages/seller/[id].tsx | Page/framework | @/lib/server/public-seller |
| pages/shop/[username].tsx | Page/framework | @/lib/server/public-shop |

## Table creation declarations

| Table | Creation source |
|---|---|
| marketplace_private.account_activity_events | supabase/migrations/202610160003_account_activity.sql:4 |
| marketplace_private.buyer_receipt_commands | supabase/migrations/202610130005_courier_possession.sql:73 |
| marketplace_private.campus_inspections | supabase/migrations/202610120008_order_campus_payment.sql:4 |
| marketplace_private.campus_payment_attempts | supabase/migrations/202610120008_order_campus_payment.sql:11 |
| marketplace_private.chat_image_cleanup | supabase/migrations/202610070002_messages_images.sql:57 |
| marketplace_private.conversation_first_contacts | supabase/migrations/202610150009_contact_seller_first_contact.sql:7 |
| marketplace_private.courier_commands | supabase/migrations/202610130005_courier_possession.sql:12 |
| marketplace_private.courier_shipments | supabase/migrations/202610130005_courier_possession.sql:3 |
| marketplace_private.delivery_checkouts | supabase/migrations/202610130003_delivery_checkout_payment.sql:8 |
| marketplace_private.external_exchanges | supabase/migrations/202610160005_dual_payment_paths.sql:248 |
| marketplace_private.financial_capabilities | supabase/migrations/202610100003_financial_capabilities.sql:3 |
| marketplace_private.handoff_authorizations | supabase/migrations/202610130004_handoff_protection.sql:8 |
| marketplace_private.handoff_key | supabase/migrations/202610130004_handoff_protection.sql:3 |
| marketplace_private.handoff_qr_commands | supabase/migrations/202610150003_order_agreement_handoff_v2.sql:102 |
| marketplace_private.meetup_commands | supabase/migrations/202610120005_order_meetup.sql:18 |
| marketplace_private.meetup_expiries | supabase/migrations/202610120005_order_meetup.sql:21 |
| marketplace_private.message_withdrawals | supabase/migrations/202610130012_message_withdrawal.sql:4 |
| marketplace_private.notification_deliveries | supabase/migrations/202610150004_notification_delivery_foundation.sql:4 |
| marketplace_private.notification_events | supabase/migrations/202610130001_notifications_domain.sql:6 |
| marketplace_private.notification_reminders | supabase/migrations/202610130006_notifications_due_work.sql:3 |
| marketplace_private.offer_accept_commands | supabase/migrations/202610120004_offer_accept.sql:56 |
| marketplace_private.offer_commands | supabase/migrations/202610120001_offer_mutations.sql:23 |
| marketplace_private.order_agreements | supabase/migrations/202610150003_order_agreement_handoff_v2.sql:4 |
| marketplace_private.order_cancellation_intents | supabase/migrations/202610140002_order_cancellation_settlement.sql:9 |
| marketplace_private.order_commands | supabase/migrations/202610100001_order_requests.sql:97 |
| marketplace_private.order_flow_commands | supabase/migrations/202610140002_order_cancellation_settlement.sql:34 |
| marketplace_private.order_media_assets | supabase/migrations/202610120003_order_snapshot_media.sql:27 |
| marketplace_private.order_media_batches | supabase/migrations/202610120003_order_snapshot_media.sql:10 |
| marketplace_private.order_media_commands | supabase/migrations/202610120003_order_snapshot_media.sql:23 |
| marketplace_private.order_protection | supabase/migrations/202610130004_handoff_protection.sql:21 |
| marketplace_private.order_settlement_authorizations | supabase/migrations/202610140002_order_cancellation_settlement.sql:22 |
| marketplace_private.order_snapshot_media | supabase/migrations/202610120003_order_snapshot_media.sql:37 |
| marketplace_private.pending_signup_controls | supabase/migrations/202610090001_auth_pending_username.sql:3 |
| marketplace_private.protection_cases | supabase/migrations/202610130004_handoff_protection.sql:28 |
| marketplace_private.seller_delivery_starts | supabase/migrations/202610140002_order_cancellation_settlement.sql:5 |
| marketplace_private.stripe_bindings | supabase/migrations/202610160004_stripe_account_setup.sql:3 |
| marketplace_private.stripe_setup_operations | supabase/migrations/202610160004_stripe_account_setup.sql:29 |
| marketplace_private.stripe_webhook_inbox | supabase/migrations/202610160004_stripe_account_setup.sql:38 |
| marketplace_private.username_history | supabase/migrations/202610030001_marketplace_usernames.sql:32 |
| marketplace_private.v2_order_economics | supabase/migrations/202610130002_delivery_area_economics.sql:33 |
| public.conversations | supabase/migrations/202610070001_messages_text.sql:11 |
| public.image_message_submissions | supabase/migrations/202610070002_messages_images.sql:12 |
| public.listing_favorites | supabase/migrations/202610050001_marketplace_publication_favorites.sql:152 |
| public.listing_images | supabase/migrations/202609290001_marketplace.sql:86 |
| public.listings | supabase/migrations/202609290001_marketplace.sql:66 |
| public.message_images | supabase/migrations/202610070002_messages_images.sql:40 |
| public.messages | supabase/migrations/202610070001_messages_text.sql:42 |
| public.notification_preferences | supabase/migrations/202610160002_notification_preferences.sql:3 |
| public.notifications | supabase/migrations/202610130001_notifications_domain.sql:16 |
| public.order_meetup_revisions | supabase/migrations/202610120005_order_meetup.sql:3 |
| public.order_requests | supabase/migrations/202610100001_order_requests.sql:5 |
| public.orders | supabase/migrations/202610100002_order_accept.sql:8 |
| public.profiles | supabase/migrations/202609290001_marketplace.sql:39 |
| public.shops | supabase/migrations/202610160006_shop_profile_foundation.sql:15 |
| public.transaction_events | supabase/migrations/202610100001_order_requests.sql:80 |

## RPC/function definition lookup

| Function name (overloads collapsed) | Last CREATE/REPLACE source |
|---|---|
| marketplace_private.account_activity_buckets | supabase/migrations/202610160003_account_activity.sql:73 |
| marketplace_private.apply_text_message_activity | supabase/migrations/202610070001_messages_text.sql:171 |
| marketplace_private.assert_image_objects | supabase/migrations/202610070002_messages_images.sql:269 |
| marketplace_private.assert_listing_images_complete | supabase/migrations/202610050001_marketplace_publication_favorites.sql:46 |
| marketplace_private.assert_order_progression | supabase/migrations/202610140002_order_cancellation_settlement.sql:59 |
| marketplace_private.begin_order_protection | supabase/migrations/202610130004_handoff_protection.sql:85 |
| marketplace_private.bind_order_media | supabase/migrations/202610120003_order_snapshot_media.sql:118 |
| marketplace_private.broadcast_notification_removal | supabase/migrations/202610160001_notification_inbox_management.sql:65 |
| marketplace_private.call_email_worker | supabase/migrations/202610150006_notification_scheduler_transport_privacy.sql:7 |
| marketplace_private.cancel_legacy_order | supabase/migrations/202610140002_order_cancellation_settlement.sql:248 |
| marketplace_private.capture_listing_activity | supabase/migrations/202610160003_account_activity.sql:18 |
| marketplace_private.capture_offer_material | supabase/migrations/202610120004_offer_accept.sql:15 |
| marketplace_private.check_message_image_manifest | supabase/migrations/202610070002_messages_images.sql:354 |
| marketplace_private.cleanup_notification_inbox | supabase/migrations/202610160001_notification_inbox_management.sql:76 |
| marketplace_private.close_terminal_meetup | supabase/migrations/202610120005_order_meetup.sql:281 |
| marketplace_private.create_order_agreement | supabase/migrations/202610150003_order_agreement_handoff_v2.sql:24 |
| marketplace_private.create_paid_handoff | supabase/migrations/202610140002_order_cancellation_settlement.sql:701 |
| marketplace_private.create_profile | supabase/migrations/202610090001_auth_pending_username.sql:13 |
| marketplace_private.default_contact_acknowledgement | supabase/migrations/202610150009_contact_seller_first_contact.sql:19 |
| marketplace_private.deliver_notification | supabase/migrations/202610130001_notifications_domain.sql:46 |
| marketplace_private.emit_offer_event | supabase/migrations/202610130011_offer_revision_domain.sql:142 |
| marketplace_private.emit_order_domain_event | supabase/migrations/202610130004_handoff_protection.sql:43 |
| marketplace_private.enforce_western_email | supabase/migrations/202609290001_marketplace.sql:28 |
| marketplace_private.expire_conversation_offers | supabase/migrations/202610130011_offer_revision_domain.sql:259 |
| marketplace_private.expire_order_requests | supabase/migrations/202610110004_offer_protocol_isolation.sql:137 |
| marketplace_private.external_exchange_started | supabase/migrations/202610160005_dual_payment_paths.sql:262 |
| marketplace_private.finalize_order_cancellation | supabase/migrations/202610140002_order_cancellation_settlement.sql:119 |
| marketplace_private.financial_capabilities_projection | supabase/migrations/202610100003_financial_capabilities.sql:23 |
| marketplace_private.freeze_v2_order_economics | supabase/migrations/202610160005_dual_payment_paths.sql:229 |
| marketplace_private.guard_agreement_payment | supabase/migrations/202610160005_dual_payment_paths.sql:343 |
| marketplace_private.guard_image_submission | supabase/migrations/202610070002_messages_images.sql:76 |
| marketplace_private.guard_message_image | supabase/migrations/202610070002_messages_images.sql:325 |
| marketplace_private.guard_message_origin | supabase/migrations/202610150009_contact_seller_first_contact.sql:23 |
| marketplace_private.initialize_delivery_checkout | supabase/migrations/202610130003_delivery_checkout_payment.sql:26 |
| marketplace_private.invoke_email_worker | supabase/migrations/202610150006_notification_scheduler_transport_privacy.sql:18 |
| marketplace_private.is_western_user | supabase/migrations/202609290001_marketplace.sql:7 |
| marketplace_private.listing_media_material_hash | supabase/migrations/202610120003_order_snapshot_media.sql:48 |
| marketplace_private.lock_financial_capability | supabase/migrations/202610110001_order_payout_gate.sql:6 |
| marketplace_private.lock_image_submission | supabase/migrations/202610070002_messages_images.sql:145 |
| marketplace_private.lock_order_participant | supabase/migrations/202610140002_order_cancellation_settlement.sql:67 |
| marketplace_private.meetup_event | supabase/migrations/202610120005_order_meetup.sql:271 |
| marketplace_private.meetup_mutable | supabase/migrations/202610160005_dual_payment_paths.sql:325 |
| marketplace_private.mutate_offer | supabase/migrations/202610130011_offer_revision_domain.sql:236 |
| marketplace_private.mutate_offer_revision | supabase/migrations/202610160005_dual_payment_paths.sql:59 |
| marketplace_private.mutate_order_request | supabase/migrations/202610110004_offer_protocol_isolation.sql:148 |
| marketplace_private.normalize_checkout_address | supabase/migrations/202610130003_delivery_checkout_payment.sql:42 |
| marketplace_private.normalize_delivery_area | supabase/migrations/202610130002_delivery_area_economics.sql:4 |
| marketplace_private.normalize_offer_terms | supabase/migrations/202610130002_delivery_area_economics.sql:23 |
| marketplace_private.notification_email_enabled | supabase/migrations/202610150004_notification_delivery_foundation.sql:25 |
| marketplace_private.notify_conversation_realtime | supabase/migrations/202610080001_messages_realtime.sql:84 |
| marketplace_private.notify_external_exchange | supabase/migrations/202610160005_dual_payment_paths.sql:664 |
| marketplace_private.notify_message_realtime | supabase/migrations/202610080001_messages_realtime.sql:59 |
| marketplace_private.notify_notification_delivery | supabase/migrations/202610160002_notification_preferences.sql:49 |
| marketplace_private.notify_order_history | supabase/migrations/202610100002_order_accept.sql:157 |
| marketplace_private.offer_accept_eligibility | supabase/migrations/202610130011_offer_revision_domain.sql:171 |
| marketplace_private.offer_changed_fields | supabase/migrations/202610160005_dual_payment_paths.sql:208 |
| marketplace_private.order_agreement_ready | supabase/migrations/202610150003_order_agreement_handoff_v2.sql:36 |
| marketplace_private.order_cancel_before_cutoff | supabase/migrations/202610160005_dual_payment_paths.sql:329 |
| marketplace_private.order_event | supabase/migrations/202610130004_handoff_protection.sql:370 |
| marketplace_private.order_media_manifest | supabase/migrations/202610120003_order_snapshot_media.sql:55 |
| marketplace_private.order_money | supabase/migrations/202610100002_order_accept.sql:76 |
| marketplace_private.order_progression_allowed | supabase/migrations/202610160005_dual_payment_paths.sql:337 |
| marketplace_private.order_request_event | supabase/migrations/202610120001_offer_mutations.sql:135 |
| marketplace_private.payment_mode | supabase/migrations/202610160005_dual_payment_paths.sql:17 |
| marketplace_private.prepare_request_protocol_identity | supabase/migrations/202610120001_offer_mutations.sql:93 |
| marketplace_private.prepare_text_message | supabase/migrations/202610070002_messages_images.sql:288 |
| marketplace_private.project_agreement_notification | supabase/migrations/202610150007_notification_agreement_trigger_return.sql:3 |
| marketplace_private.project_listing_price_drop | supabase/migrations/202610130001_notifications_domain.sql:106 |
| marketplace_private.project_message_notification | supabase/migrations/202610150009_contact_seller_first_contact.sql:88 |
| marketplace_private.project_payout_notification | supabase/migrations/202610130009_payout_notifications.sql:3 |
| marketplace_private.project_transaction_notification | supabase/migrations/202610160005_dual_payment_paths.sql:726 |
| marketplace_private.protect_conversation_identity | supabase/migrations/202610160009_message_shop_provenance.sql:8 |
| marketplace_private.protect_favorite_eligibility | supabase/migrations/202610050001_marketplace_publication_favorites.sql:172 |
| marketplace_private.protect_listing_channel | supabase/migrations/202610160007_listing_channel_authority.sql:7 |
| marketplace_private.protect_listing_delivery_estimate | supabase/migrations/202610150002_listing_fulfillment_defaults.sql:12 |
| marketplace_private.protect_listing_fulfillment | supabase/migrations/202610130013_offer_revision_guards.sql:154 |
| marketplace_private.protect_listing_inventory | supabase/migrations/202610160005_dual_payment_paths.sql:589 |
| marketplace_private.protect_listing_meeting | supabase/migrations/202610150001_meeting_location_references.sql:21 |
| marketplace_private.protect_listing_payment_mode | supabase/migrations/202610160005_dual_payment_paths.sql:10 |
| marketplace_private.protect_listing_publication | supabase/migrations/202610050001_marketplace_publication_favorites.sql:61 |
| marketplace_private.protect_listing_taxonomy | supabase/migrations/202610040001_marketplace_taxonomy.sql:41 |
| marketplace_private.protect_meetup_revision | supabase/migrations/202610120005_order_meetup.sql:41 |
| marketplace_private.protect_message_withdrawal_insert | supabase/migrations/202610130012_message_withdrawal.sql:18 |
| marketplace_private.protect_order | supabase/migrations/202610160005_dual_payment_paths.sql:355 |
| marketplace_private.protect_order_request | supabase/migrations/202610130011_offer_revision_domain.sql:101 |
| marketplace_private.protect_published_listing_images | supabase/migrations/202610050001_marketplace_publication_favorites.sql:112 |
| marketplace_private.protect_sent_message | supabase/migrations/202610130012_message_withdrawal.sql:24 |
| marketplace_private.protect_transaction_event | supabase/migrations/202610100001_order_requests.sql:139 |
| marketplace_private.protect_unfinished_order_participant | supabase/migrations/202610100002_order_accept.sql:148 |
| marketplace_private.protect_username_identity | supabase/migrations/202610090001_auth_pending_username.sql:32 |
| marketplace_private.protect_v2_order_economics | supabase/migrations/202610130002_delivery_area_economics.sql:67 |
| marketplace_private.queue_conversation_chat_images | supabase/migrations/202610070002_messages_images.sql:436 |
| marketplace_private.record_order_flow_command | supabase/migrations/202610140002_order_cancellation_settlement.sql:89 |
| marketplace_private.require_notification_worker | supabase/migrations/202610150005_notification_edge_service_claims.sql:5 |
| marketplace_private.require_seller_payout_ready | supabase/migrations/202610110001_order_payout_gate.sql:15 |
| marketplace_private.require_stripe_staging | supabase/migrations/202610160004_stripe_account_setup.sql:60 |
| marketplace_private.retire_notification_delivery | supabase/migrations/202610150008_notification_delivery_audit_retention.sql:3 |
| marketplace_private.run_transaction_due_work | supabase/migrations/202610160005_dual_payment_paths.sql:761 |
| marketplace_private.schedule_order_reminders | supabase/migrations/202610130006_notifications_due_work.sql:64 |
| marketplace_private.seed_external_exchange | supabase/migrations/202610160005_dual_payment_paths.sql:258 |
| marketplace_private.seed_order_meetup | supabase/migrations/202610120005_order_meetup.sql:68 |
| marketplace_private.settle_delivery_checkout | supabase/migrations/202610130003_delivery_checkout_payment.sql:123 |
| marketplace_private.settle_listing_reservation | supabase/migrations/202610130003_delivery_checkout_payment.sql:379 |
| marketplace_private.settle_order_meetup | supabase/migrations/202610120005_order_meetup.sql:111 |
| marketplace_private.settle_order_protection | supabase/migrations/202610130004_handoff_protection.sql:157 |
| marketplace_private.shop_profile_text_length | supabase/migrations/202610160006_shop_profile_foundation.sql:7 |
| marketplace_private.touch_updated_at | supabase/migrations/202609290001_marketplace.sql:60 |
| marketplace_private.trim_message_text | supabase/migrations/202610070001_messages_text.sql:6 |
| marketplace_private.username_reserved | supabase/migrations/202610030001_marketplace_usernames.sql:7 |
| marketplace_private.username_valid | supabase/migrations/202610030001_marketplace_usernames.sql:3 |
| marketplace_private.v2_buyer_service_fee | supabase/migrations/202610130010_offer_revision_economics.sql:4 |
| marketplace_private.v2_order_money | supabase/migrations/202610130002_delivery_area_economics.sql:72 |
| marketplace_private.valid_meeting_reference | supabase/migrations/202610150001_meeting_location_references.sql:4 |
| marketplace_private.validate_meetup | supabase/migrations/202610120005_order_meetup.sql:29 |
| marketplace_private.validate_offer_terms | supabase/migrations/202610160005_dual_payment_paths.sql:22 |
| marketplace_private.verify_image_ready | supabase/migrations/202609290001_marketplace.sql:147 |
| marketplace_private.verify_v2_order_commit | supabase/migrations/202610120005_order_meetup.sql:297 |
| public.before_western_user_created | supabase/migrations/202609290001_marketplace.sql:15 |
| public.marketplace_abandon_image_message | supabase/migrations/202610070002_messages_images.sql:403 |
| public.marketplace_accept_offer | supabase/migrations/202610160008_order_shop_provenance.sql:4 |
| public.marketplace_accept_order_request | supabase/migrations/202610160008_order_shop_provenance.sql:67 |
| public.marketplace_account_activity | supabase/migrations/202610160003_account_activity.sql:97 |
| public.marketplace_ack_chat_image_cleanup | supabase/migrations/202610070002_messages_images.sql:450 |
| public.marketplace_authorize_email_worker | supabase/migrations/202610150004_notification_delivery_foundation.sql:219 |
| public.marketplace_campus_payment_state | supabase/migrations/202610130002_delivery_area_economics.sql:179 |
| public.marketplace_cancel_order | supabase/migrations/202610160005_dual_payment_paths.sql:505 |
| public.marketplace_cancel_order_request | supabase/migrations/202610100001_order_requests.sql:290 |
| public.marketplace_change_username | supabase/migrations/202610030001_marketplace_usernames.sql:147 |
| public.marketplace_claim_email_deliveries | supabase/migrations/202610160002_notification_preferences.sql:70 |
| public.marketplace_claim_order_media_cleanup | supabase/migrations/202610120003_order_snapshot_media.sql:138 |
| public.marketplace_confirm_campus_inspection | supabase/migrations/202610130015_offer_revision_inspection_economics.sql:13 |
| public.marketplace_confirm_courier_received | supabase/migrations/202610140002_order_cancellation_settlement.sql:651 |
| public.marketplace_confirm_external_exchange | supabase/migrations/202610160005_dual_payment_paths.sql:278 |
| public.marketplace_confirm_order_agreement | supabase/migrations/202610150003_order_agreement_handoff_v2.sql:55 |
| public.marketplace_confirm_username | supabase/migrations/202610030001_marketplace_usernames.sql:119 |
| public.marketplace_contact_seller | supabase/migrations/202610150009_contact_seller_first_contact.sql:46 |
| public.marketplace_correct_pending_username | supabase/migrations/202610090001_auth_pending_username.sql:83 |
| public.marketplace_courier_state | supabase/migrations/202610130005_courier_possession.sql:100 |
| public.marketplace_create_offer | supabase/migrations/202610120001_offer_mutations.sql:226 |
| public.marketplace_create_order_request | supabase/migrations/202610100001_order_requests.sql:286 |
| public.marketplace_delivery_checkout | supabase/migrations/202610130003_delivery_checkout_payment.sql:69 |
| public.marketplace_deny_offer | supabase/migrations/202610130011_offer_revision_domain.sql:240 |
| public.marketplace_dispute_external_exchange | supabase/migrations/202610160005_dual_payment_paths.sql:303 |
| public.marketplace_expire_image_submissions | supabase/migrations/202610070002_messages_images.sql:418 |
| public.marketplace_external_exchange | supabase/migrations/202610160005_dual_payment_paths.sql:265 |
| public.marketplace_finalize_image_message | supabase/migrations/202610070002_messages_images.sql:379 |
| public.marketplace_finalize_listing | supabase/migrations/202610160007_listing_channel_authority.sql:24 |
| public.marketplace_financial_capabilities | supabase/migrations/202610100003_financial_capabilities.sql:33 |
| public.marketplace_financial_capabilities_for_user | supabase/migrations/202610100003_financial_capabilities.sql:43 |
| public.marketplace_find_or_create_conversation | supabase/migrations/202610160009_message_shop_provenance.sql:70 |
| public.marketplace_finish_email | supabase/migrations/202610150004_notification_delivery_foundation.sql:198 |
| public.marketplace_finish_order_media_cleanup | supabase/migrations/202610120003_order_snapshot_media.sql:159 |
| public.marketplace_generate_handoff_qr | supabase/migrations/202610150003_order_agreement_handoff_v2.sql:111 |
| public.marketplace_handoff_credential | supabase/migrations/202610150003_order_agreement_handoff_v2.sql:307 |
| public.marketplace_listing_offer_context | supabase/migrations/202610130011_offer_revision_domain.sql:296 |
| public.marketplace_mark_all_notifications_read | supabase/migrations/202610160001_notification_inbox_management.sql:36 |
| public.marketplace_mark_conversation_read | supabase/migrations/202610150009_contact_seller_first_contact.sql:104 |
| public.marketplace_mark_notification_read | supabase/migrations/202610160001_notification_inbox_management.sql:24 |
| public.marketplace_mutate_notifications | supabase/migrations/202610160001_notification_inbox_management.sql:46 |
| public.marketplace_notification_preferences | supabase/migrations/202610160002_notification_preferences.sql:15 |
| public.marketplace_notifications | supabase/migrations/202610160001_notification_inbox_management.sql:4 |
| public.marketplace_offer_accept_preflight | supabase/migrations/202610160005_dual_payment_paths.sql:134 |
| public.marketplace_offer_history | supabase/migrations/202610130011_offer_revision_domain.sql:270 |
| public.marketplace_open_protection_case | supabase/migrations/202610130004_handoff_protection.sql:134 |
| public.marketplace_order_agreement | supabase/migrations/202610150003_order_agreement_handoff_v2.sql:43 |
| public.marketplace_order_cancellation_state | supabase/migrations/202610140002_order_cancellation_settlement.sql:146 |
| public.marketplace_order_detail | supabase/migrations/202610100002_order_accept.sql:426 |
| public.marketplace_order_economics | supabase/migrations/202610130002_delivery_area_economics.sql:80 |
| public.marketplace_order_fulfillment | supabase/migrations/202610160005_dual_payment_paths.sql:632 |
| public.marketplace_order_media_cleanup_candidates | supabase/migrations/202610120003_order_snapshot_media.sql:167 |
| public.marketplace_order_media_delete_lease | supabase/migrations/202610120003_order_snapshot_media.sql:150 |
| public.marketplace_order_meetup_action | supabase/migrations/202610120005_order_meetup.sql:77 |
| public.marketplace_order_meetup_history | supabase/migrations/202610120005_order_meetup.sql:285 |
| public.marketplace_order_request_history | supabase/migrations/202610110004_offer_protocol_isolation.sql:297 |
| public.marketplace_order_snapshot_media | supabase/migrations/202610120003_order_snapshot_media.sql:173 |
| public.marketplace_order_workspace | supabase/migrations/202610100002_order_accept.sql:246 |
| public.marketplace_pending_signup_resumable | supabase/migrations/202610140003_auth_pending_resumability.sql:3 |
| public.marketplace_prepare_email | supabase/migrations/202610160002_notification_preferences.sql:82 |
| public.marketplace_prepare_image_message | supabase/migrations/202610070002_messages_images.sql:166 |
| public.marketplace_prepare_order_media | supabase/migrations/202610120003_order_snapshot_media.sql:61 |
| public.marketplace_record_courier_shipment | supabase/migrations/202610140002_order_cancellation_settlement.sql:601 |
| public.marketplace_record_financial_capability | supabase/migrations/202610110001_order_payout_gate.sql:33 |
| public.marketplace_record_listing_view | supabase/migrations/202610160003_account_activity.sql:48 |
| public.marketplace_record_trusted_courier_delivery | supabase/migrations/202610140002_order_cancellation_settlement.sql:627 |
| public.marketplace_record_verified_chat_image | supabase/migrations/202610070002_messages_images.sql:235 |
| public.marketplace_replace_order_request | supabase/migrations/202610100001_order_requests.sql:288 |
| public.marketplace_request_delivery_full_refund | supabase/migrations/202610140002_order_cancellation_settlement.sql:167 |
| public.marketplace_resolve_campus_payment | supabase/migrations/202610140002_order_cancellation_settlement.sql:674 |
| public.marketplace_respond_delivery_cancellation | supabase/migrations/202610140002_order_cancellation_settlement.sql:190 |
| public.marketplace_run_transaction_due_work | supabase/migrations/202610130006_notifications_due_work.sql:134 |
| public.marketplace_save_delivery_address | supabase/migrations/202610150003_order_agreement_handoff_v2.sql:232 |
| public.marketplace_send_text | supabase/migrations/202610130013_offer_revision_guards.sql:118 |
| public.marketplace_set_notification_preference | supabase/migrations/202610160002_notification_preferences.sql:24 |
| public.marketplace_simulate_order_payment_success | supabase/migrations/202610120004_offer_accept.sql:393 |
| public.marketplace_start_campus_payment | supabase/migrations/202610130003_delivery_checkout_payment.sql:316 |
| public.marketplace_start_delivery_checkout | supabase/migrations/202610150003_order_agreement_handoff_v2.sql:206 |
| public.marketplace_start_order_payment | supabase/migrations/202610160005_dual_payment_paths.sql:674 |
| public.marketplace_start_seller_delivery | supabase/migrations/202610140002_order_cancellation_settlement.sql:100 |
| public.marketplace_stripe_binding | supabase/migrations/202610160004_stripe_account_setup.sql:70 |
| public.marketplace_stripe_capabilities | supabase/migrations/202610160004_stripe_account_setup.sql:130 |
| public.marketplace_stripe_events | supabase/migrations/202610160004_stripe_account_setup.sql:139 |
| public.marketplace_submit_offer | supabase/migrations/202610130011_offer_revision_domain.sql:238 |
| public.marketplace_username_available | supabase/migrations/202610030001_marketplace_usernames.sql:105 |
| public.marketplace_verify_handoff | supabase/migrations/202610150003_order_agreement_handoff_v2.sql:257 |
| public.marketplace_verify_order_media | supabase/migrations/202610120003_order_snapshot_media.sql:94 |
| public.marketplace_withdraw_message | supabase/migrations/202610130012_message_withdrawal.sql:38 |
| public.marketplace_withdraw_offer | supabase/migrations/202610120001_offer_mutations.sql:228 |
