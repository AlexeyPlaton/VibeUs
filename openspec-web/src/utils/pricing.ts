export type PricingMarket = 'ru' | 'global';
export type PaidPlan = 'solo' | 'studio';

export type PricingPlan = {
  amount: string;
  display: string;
  project_limit: number;
};

export type PricingMarketData = {
  market: PricingMarket;
  currency: 'RUB' | 'USD';
  period_days: number;
  visible?: boolean;
  billing_enabled: boolean;
  plans: Record<PaidPlan, PricingPlan>;
};

export type PricingCatalog = {
  default_market: PricingMarket;
  period_days: number;
  markets: Record<PricingMarket, PricingMarketData>;
};

export async function fetchPricing(baseUrl: string): Promise<PricingCatalog> {
  const res = await fetch(`${baseUrl}/api/public/pricing`, { credentials: 'omit' });
  if (!res.ok) throw new Error('PRICING_FETCH_FAILED');
  return res.json();
}

export function chooseInitialMarket(catalog: PricingCatalog, requested?: string | null): PricingMarket {
  const candidate = requested || localStorage.getItem('vibeus_pricing_market') || '';
  if (candidate === 'global' && catalog.markets.global.visible) return 'global';
  if (candidate === 'ru') return 'ru';
  if (catalog.default_market === 'global' && catalog.markets.global.visible) return 'global';
  return 'ru';
}

export function rememberMarket(market: PricingMarket) {
  localStorage.setItem('vibeus_pricing_market', market);
}

/** Returns only the localized amount produced by the pricing API. Period/unit copy belongs to i18n UI layers. */
export function displayPrice(catalog: PricingCatalog | null, market: PricingMarket, plan: PaidPlan): string {
  return catalog?.markets?.[market]?.plans?.[plan]?.display || '—';
}
