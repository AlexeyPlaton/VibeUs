import { useMemo, useState } from 'react';
import { ArrowLeft, CreditCard, Loader2, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { tr } from '../i18n/config';

const ISO2 = `AF AL DZ AS AD AO AI AQ AG AR AM AW AU AZ BS BH BD BB BY BZ BJ BM BT BO BQ BA BW BV BR IO BN BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI CU CW DJ DM DO EC EG SV GQ ER SZ ET FK FO FJ GF PF TF GA GM GE GH GI GL GD GP GU GT GG GN GW GY HT HM VA HN HK IN ID IR IQ IM IL JM JP JE JO KZ KE KI KP KR KW KG LA LB LS LR LY MO MG MW MY MV ML MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NC NZ NI NE NG NU NF MK MP OM PK PW PS PA PG PY PE PH PN PR QA RE RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SB SO ZA GS SS LK SD SR SJ CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW`.split(' ');

function apiUrl() {
  return window.location.origin.includes('localhost') ? 'http://localhost:8000' : window.location.origin;
}

export function InternationalCheckoutPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const workspaceId = params.get('workspace') || '';
  const tier = params.get('tier') === 'studio' ? 'studio' : 'solo';
  const successUrl = params.get('success') || `${window.location.origin}/app?payment=return&market=global`;
  const cancelUrl = params.get('cancel') || `${window.location.origin}/app?payment=cancel&market=global`;
  const [country, setCountry] = useState('');
  const [businessUse, setBusinessUse] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const countries = useMemo(() => {
    const locale = document.documentElement.lang || navigator.language || 'en';
    let names: Intl.DisplayNames | null = null;
    try { names = new Intl.DisplayNames([locale], { type: 'region' }); } catch {}
    return ISO2
      .map((code) => ({ code, label: names?.of(code) || code }))
      .sort((a, b) => a.label.localeCompare(b.label, locale));
  }, []);

  const startPayment = async () => {
    if (!workspaceId || !country || !businessUse) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl()}/api/billing/checkout`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          tier,
          market: 'global',
          success_url: successUrl,
          cancel_url: cancelUrl,
          billing_country: country,
          business_use_confirmed: businessUse,
          culture: (document.documentElement.lang || '').toLowerCase().startsWith('ru') ? 'ru-RU' : 'en-US',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = typeof data?.detail === 'string' ? data.detail : data?.error?.message;
        throw new Error(message || tr('v7.create.errors.payment'));
      }
      if (!data.checkout_url) throw new Error(tr('v7.create.errors.checkout_url'));
      window.location.assign(data.checkout_url);
    } catch (e: any) {
      setError(e?.message || tr('v7.create.errors.payment'));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-6">
      <div className="mx-auto max-w-xl">
        <div className="mb-5 flex items-center justify-between">
          <button type="button" onClick={() => history.back()} className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
            <ArrowLeft className="h-4 w-4" />{tr('v7.create.nav.home')}
          </button>
          <LanguageSwitcher compact />
        </div>

        <main className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] shadow-2xl shadow-black/30">
          <div className="border-b border-white/10 bg-gradient-to-br from-indigo-500/15 via-transparent to-cyan-500/10 p-6 sm:p-8">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-indigo-300/20 bg-indigo-500/15 text-indigo-200">
              <CreditCard className="h-5 w-5" />
            </div>
            <h1 className="mt-5 text-2xl font-bold">International checkout</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              VibeUs needs the billing country before opening the payment provider. This is separate from your UI language or card-issuer location.
            </p>
          </div>

          <div className="space-y-5 p-6 sm:p-8">
            {error && <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs uppercase tracking-[.16em] text-slate-500">Plan</div>
              <div className="mt-1 text-lg font-bold">{tier === 'studio' ? 'Studio' : 'Solo'}</div>
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold">Billing country</span>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-indigo-400/50"
              >
                <option value="">Select country…</option>
                {countries.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
              </select>
            </label>

            <label className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-sm leading-relaxed text-slate-300">
              <input
                type="checkbox"
                checked={businessUse}
                onChange={(e) => setBusinessUse(e.target.checked)}
                className="mt-1 h-4 w-4 shrink-0"
              />
              <span>I confirm this purchase is for business or professional use and that the billing details I provide are accurate.</span>
            </label>

            <div className="flex gap-3 rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.06] p-4 text-xs leading-relaxed text-emerald-100/80">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              Payment return pages do not activate a plan by themselves. VibeUs waits for a verified provider notification before granting access.
            </div>

            <button
              type="button"
              onClick={startPayment}
              disabled={loading || !workspaceId || !country || !businessUse}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-slate-950 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Continue to secure payment
            </button>

            <p className="text-center text-[11px] leading-relaxed text-slate-500">
              Paid hosted availability depends on country and the active payment-provider contract. <Link className="underline hover:text-slate-300" to="/legal/offer">Terms</Link>
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
