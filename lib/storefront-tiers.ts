/**
 * Credit tiers sold through the storefront. Kept free of server-only imports so
 * the recharge page and the order flow read the same list.
 */
export const STOREFRONT_CREDIT_TIERS: readonly number[] = [
  100, 500, 1000, 2000, 5000, 10000,
];
