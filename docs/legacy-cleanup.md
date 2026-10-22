# Legacy cleanup audit

Removed after tracing static imports, exports, dynamic imports and require calls
from all remaining pages and CLI roots. A second check rejected any candidate
referenced by a retained source file, including non-route infrastructure.
The three deleted stylesheets only target removed retail tag/refinement/load-more UI.

## Files removed

- `components/@autocomplete/basic/autocomplete-basic.tsx`
- `components/@autocomplete/plugins/popular-searches/popular-searches.tsx`
- `components/@instantsearch/hooks/useCurrentRefinementCount.ts`
- `components/@instantsearch/hooks/useGetRefinementWidgets.tsx`
- `components/@instantsearch/hooks/useHasRefinements.ts`
- `components/@instantsearch/hooks/useUrlSync.ts`
- `components/@instantsearch/search.tsx`
- `components/@instantsearch/utils/refinements.ts`
- `components/@instantsearch/utils/url.ts`
- `components/@instantsearch/widgets/breadcrumb/breadcrumb.tsx`
- `components/@instantsearch/widgets/clear-refinements/clear-refinements.tsx`
- `components/@instantsearch/widgets/current-refinements/current-refinements.tsx`
- `components/@instantsearch/widgets/current-refinements/getCurrentRefinement.ts`
- `components/@instantsearch/widgets/dynamic-widgets/dynamic-widgets.tsx`
- `components/@instantsearch/widgets/expandable-panel/expandable-panel.tsx`
- `components/@instantsearch/widgets/infinite-hits/infinite-hits.tsx`
- `components/@instantsearch/widgets/load-less/load-less.tsx`
- `components/@instantsearch/widgets/load-more/load-more.tsx`
- `components/@instantsearch/widgets/no-results-handler/no-results-current-refinements.tsx`
- `components/@instantsearch/widgets/no-results-handler/no-results-handler.tsx`
- `components/@instantsearch/widgets/no-results-handler/no-results-query-suggestions.tsx`
- `components/@instantsearch/widgets/query-rule-banners/query-rule-banners.tsx`
- `components/@instantsearch/widgets/range-input/range-input-currency.tsx`
- `components/@instantsearch/widgets/range-input/range-input.tsx`
- `components/@instantsearch/widgets/rating-selector/rating-selector.tsx`
- `components/@instantsearch/widgets/refinements-dropdown/dropdown-refinements.tsx`
- `components/@instantsearch/widgets/relevant-sort/relevant-sort.tsx`
- `components/@instantsearch/widgets/see-results-button/see-results-button.tsx`
- `components/@instantsearch/widgets/sort-by/sort-by.tsx`
- `components/@instantsearch/widgets/virtual-search-box/virtual-search-box.tsx`
- `components/@instantsearch/widgets/virtual-stats/virtual-stats.tsx`
- `components/footer/footer.tsx`
- `components/header/header.tsx`
- `components/logo/logo.tsx`
- `components/nav/nav-autocomplete.tsx`
- `components/nav/nav-bottom.tsx`
- `components/nav/nav-item.tsx`
- `components/nav/nav-top.tsx`
- `components/nav/nav.tsx`
- `components/product/product-color-variation-item.tsx`
- `components/product/product-color-variation-list.tsx`
- `components/product/product-description.tsx`
- `components/product/product-favorite.tsx`
- `components/product/product-label.tsx`
- `components/product/product-price.tsx`
- `components/product/product-rating.tsx`
- `components/product/product-sizes.tsx`
- `components/product/product-tag.tsx`
- `components/product/product-title.tsx`
- `components/product-card/product-card-hit.tsx`
- `components/product-card/product-card.tsx`
- `components/product-detail/product-detail-hit.tsx`
- `components/product-detail/product-detail.tsx`
- `components/products-showcase/products-showcase.tsx`
- `components/refinements-bar/refinements-bar-dropdowns.tsx`
- `components/refinements-bar/refinements-bar.tsx`
- `components/refinements-panel/refinements-panel-body.tsx`
- `components/refinements-panel/refinements-panel-footer.tsx`
- `components/refinements-panel/refinements-panel-header.tsx`
- `components/refinements-panel/refinements-panel-widget.tsx`
- `components/refinements-panel/refinements-panel.tsx`
- `components/toggle-filters/toggle-filters.tsx`
- `components/view-modes/view-modes.tsx`
- `layouts/search-page-layout.tsx`
- `utils/getResultsState.ts`
- `pages/catalog/[[...slugs]].tsx`
- `pages/product/[objectID].tsx`
- `components/product/product-tag.css`
- `components/refinements-panel/refinements-panel.css`
- `components/@instantsearch/widgets/load-more/load-more.css`

## Algolia removal

Marketplace result queries and suggestions continue to use the existing Supabase
listing boundary and `lib/market-search.ts`. The unused Algolia client, Insights,
InstantSearch state, legacy Autocomplete component chain, CLI, environment
placeholders, styles, typings and direct npm dependencies have been removed.

AppLayout retains its Jotai, motion and responsive providers without injecting an
Algolia client. The page loader now depends only on the existing route transition
state. Current Market search, filtering, sorting and pagination code was not changed.

## Other retention and scope

ProductImage is used by ListingCard. UI primitives, Banner/demo kit routes, motion,
Jotai providers, responsive utilities, PWA artwork and public assets remain. The
package manifest, lockfile and environment sample changed only to remove the retired
Algolia integration. Image and icon assets were not modified or removed. The original
README remains as a historical template reference. No visual redesign or marketplace
business logic edits were performed during cleanup.

Validation and limitations are recorded in PROJECT_STATUS.md.
