// Real UI/hooks, existing HTTP contracts mocked locally. No hosted or manual fixtures.
const fs = require('node:fs')
const path = require('node:path')
const { root } = require('./message-payload.browser.cjs')
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {LazyMotion,domAnimation} from 'framer-motion';
import {FormalOrderDetail} from '@/components/home/formal-order-detail';
import '@/components/animata/button/shining-button.css';
const root=createRoot(document.getElementById('root'));
window.actions=[];window.requests=[];window.protocolErrors=[];window.failRefresh=false;window.rejectWrites=false;
const now=()=>new Date().toISOString();
window.renderModel=()=>{const m=window.model;flushSync(()=>root.render(<LazyMotion features={domAnimation}><FormalOrderDetail key={m.key} order={m.order} userId={m.viewer} mode={m.viewer==='seller'?'sales':'purchases'} offset={0} onBack={()=>window.actions.push('back')} onRefresh={window.refreshModel} onUpdated={(order)=>{m.order=order;window.renderModel()}} onCancelled={(order)=>{m.order=order;window.renderModel()}}/></LazyMotion>))};
window.refreshModel=async()=>{if(window.failRefresh)throw Error('Controlled refresh failure');window.model.order={...window.model.order};window.renderModel()};
window.fixtureRequest=async(url,method,body)=>{
window.requests.push({url,method,body});const m=window.model,o=m.order;
if(method==='GET'){
if(url.endsWith('/fulfillment'))return {...m.fulfillment};
if(url.endsWith('/checkout'))return {...m.checkout,address:m.checkout.address};
if(url.endsWith('/courier'))return {...m.courier};
if(url.endsWith('/credential')){if(m.viewer!=='buyer'||o.paymentStatus!=='paid'||m.mode==='courier'||!m.fulfillment.handoffReady){window.protocolErrors.push('Credential boundary');throw Error('Credential boundary')}return {available:true,code:'123456',qrToken:'a'.repeat(64)}}
throw Error('Unexpected fixture GET');}
if(window.rejectWrites)throw Error('Controlled mutation failure');
if(url.endsWith('/cancel')){o.lifecycle='cancelled';o.holdsListing=false;o.cancellation={at:now(),byRole:m.viewer,reasonCode:body.reason,reason:'Fixture cancellation',note:body.note};m.fulfillment.cancellation={...m.fulfillment.cancellation,canCancel:false,state:'finalized'};return {order:{...o},serverTime:now()}}
if(url.includes('/meetup/proposals/')&&url.endsWith('/confirm')){o.meetup.revisions=o.meetup.revisions.map(r=>({...r,status:r.id==='proposal'?'confirmed':'superseded'}));return {order:{...o},serverTime:now()}}
if(url.endsWith('/inspection/confirm')){o.campusPayment={...o.campusPayment,inspectionConfirmedAt:now()};return {order:{...o},serverTime:now()}}
if(url.endsWith('/payment/start')){o.paymentStatus='paid';o.paymentPaidAt=now();m.fulfillment.handoffReady=true;return {order:{...o},serverTime:now()}}
if(url.endsWith('/checkout')){if(!m.checkout.checkoutStartedAt){m.checkout.checkoutStartedAt=now();m.checkout.paymentDeadlineAt=new Date(Date.now()+1800000).toISOString()}return {...m.checkout}}
if(url.endsWith('/address')){m.checkout.address={...body.address};return {...m.checkout}}
if(url.endsWith('/payment')){o.paymentStatus='processing';return {status:'processing'}}
if(url.endsWith('/handoff')){if(body.channel!=='code'||body.credential!=='123456')throw Error('Wrong fixture code');m.fulfillment.handoffReady=false;m.fulfillment.handoffConfirmedAt=now();m.fulfillment.protectionStartedAt=now();m.fulfillment.protectionExpiresAt=new Date(Date.now()+86400000).toISOString();return {verified:true}}
if(url.endsWith('/start-delivery')){m.fulfillment.deliveryStartedAt=now();m.fulfillment.cancellation.deliveryStartedAt=m.fulfillment.deliveryStartedAt;return {startedAt:m.fulfillment.deliveryStartedAt}}
if(url.endsWith('/request-cancellation')){m.fulfillment.cancellation={...m.fulfillment.cancellation,state:'awaiting_seller',path:'full_refund_request',canCancel:false,requestingRole:'buyer',reason:body.reason,note:body.note,requestedAt:now()};m.fulfillment.handoffReady=false;return {...m.fulfillment.cancellation}}
if(url.endsWith('/respond-cancellation')){m.fulfillment.cancellation.state=body.response==='agree'?'finalized':'disputed';m.fulfillment.cancellation.sellerResponse=body.response;if(body.response==='agree'){o.lifecycle='cancelled';o.holdsListing=false;m.fulfillment.cancellation.settlement={disposition:'full_release',securedCents:8070,buyerReleaseCents:8070,sellerDeliveryCompensationCents:0,platformRetainedCents:0,platformReversedCents:70,sellerSalePayoutCents:0,execution:'provider_not_integrated'}}return {...m.fulfillment.cancellation}}
if(url.endsWith('/shipment')){m.courier={...m.courier,state:'shipped',shippedAt:now(),carrierLabel:body.carrierLabel,trackingReference:body.trackingReference};return {shipped:true}}
if(url.endsWith('/received')){m.fulfillment.protectionStartedAt=now();m.fulfillment.protectionExpiresAt=new Date(Date.now()+86400000).toISOString();return {received:true}}
if(url.endsWith('/case')){m.fulfillment.protectionHold=true;m.fulfillment.caseState='open';return {state:'open'}}
throw Error('Unexpected fixture mutation')};
window.setScenario=(v)=>{
window.requests=[];window.protocolErrors=[];window.actions=[];window.failRefresh=false;window.rejectWrites=false;
const at=now(),future=new Date(Date.now()+86400000).toISOString();
const terms=v.mode==='campus'?{fulfillment:'on_campus',meetupLocation:'Weldon',scheduledAt:future,itemAmountCents:7000,currency:'CAD',note:''}:{fulfillment:'delivery',deliveryMethod:v.mode==='courier'?'courier':'seller_delivery',deliveryFeeCents:1000,deliveryArea:{countryCode:'CA',provinceCode:'ON',cityLabel:'London',postalPrefix:'N6A'},itemAmountCents:7000,currency:'CAD',note:''};
const photo='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="purple"/></svg>');
const paid=['paid','protection','hold','completed','shipped','delivered'].includes(v.phase);
const order={id:'order-1',requestId:'offer-1',conversationId:'conversation',listingId:'listing',buyerId:'buyer',sellerId:'seller',protocolVersion:2,lifecycle:['completed','cancelled','expired'].includes(v.phase)?v.phase:'open',paymentStatus:paid?'paid':v.phase==='processing'?'processing':'pending',paymentPaidAt:paid?at:null,payoutStatus:v.phase==='completed'?'eligible':'not_eligible',fulfillmentStatus:paid?'awaiting_fulfillment':'awaiting_payment',holdsListing:!['completed','cancelled','expired'].includes(v.phase),moneyStatus:'v2_pending',itemAmount:7000,shippingAmount:0,serviceFee:null,totalAmount:null,createdAt:at,acceptedAt:at,reservationExpiresAt:null,reservationStartedAt:null,snapshot:{listing:{title:'Frozen fixture',price:8000,category:'Electronics',photoUrls:[photo]},buyer:'Buyer',seller:'Seller',draft:{fulfillment:'shipping'}},v2:{terms,askingPriceCents:8000,description:'Frozen description',subcategory:'Other',condition:'Good',materialHash:'fixture'},economics:{itemCents:7000,deliveryCents:v.mode==='campus'?0:1000,buyerServiceFeeCents:70,buyerTotalCents:v.mode==='campus'?7070:8070,sellerPlatformFeeCents:0,sellerGrossCents:v.mode==='campus'?7000:8000,feeRule:'frozen'},campusPayment:v.mode==='campus'?{inspectionConfirmedAt:['inspected','processing','paid','protection','hold','completed'].includes(v.phase)?at:null,itemCents:7000,feeCents:70,totalCents:7070}:undefined,meetup:v.mode==='campus'?{mutable:!paid,revisions:[{id:'meetup-1',revision:0,status:'confirmed',location:'Weldon',scheduledAt:future,note:'',proposerRole:'system',deciderRole:'system',proposedAt:at,decidedAt:at}]}:undefined};
if(v.phase==='cancelled')order.cancellation={at,byRole:'buyer',reasonCode:'buyer_changed_mind',reason:'Changed my mind',note:''};if(v.phase==='expired')order.expiredAt=at;
window.model={key:JSON.stringify(v),viewer:v.viewer,mode:v.mode,order,fulfillment:{orderId:'order-1',deliveryStartedAt:v.startedDelivery?at:null,cancellation:{orderId:'order-1',canCancel:!['completed','cancelled','expired','protection','hold','shipped','delivered'].includes(v.phase),state:null,deliveryStartedAt:v.startedDelivery?at:null,settlement:null},handoffReady:paid, handoffConfirmedAt:['protection','hold','completed'].includes(v.phase)&&v.mode!=='courier'?at:null,protectionStartedAt:['protection','hold','completed','delivered'].includes(v.phase)?at:null,protectionExpiresAt:new Date(Date.now()+86400000).toISOString(),protectionCompletedAt:v.phase==='completed'?at:null,protectionHold:v.phase==='hold',caseState:v.phase==='hold'?'open':null,payoutEligible:v.phase==='completed',serverTime:at},checkout:{orderId:'order-1',checkoutClaimDeadlineAt:new Date(Date.now()+43200000).toISOString(),checkoutStartedAt:v.started?at:null,paymentDeadlineAt:v.started?new Date(Date.now()+1800000).toISOString():null,addressFrozen:paid,address:{country_code:'CA',province_code:'ON',city:'London',postal_code:'N6A1A1',street:'PRIVATE TEST STREET'},serverTime:at},courier:{state:v.phase==='shipped'?'shipped':v.phase==='delivered'?'delivered':'not_shipped',shippedAt:['shipped','delivered'].includes(v.phase)?at:null,deliveredAt:v.phase==='delivered'?at:null,carrierLabel:'Test carrier',trackingReference:'TEST TRACKING'}};
if(v.addressMissing)window.model.checkout.address=null;
window.renderModel();};
`
)
// Stage-based qualification entry point; the frozen synthetic transport above is reused.
require('./order-stage-pages.browser.cjs')
