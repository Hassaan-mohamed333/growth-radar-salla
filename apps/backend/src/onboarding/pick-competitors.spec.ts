import type { DiscoveryDto } from '../competitor-insights/competitor-insights.service';
import { pickCompetitors } from './onboarding.service';

const d = (domain: string, kind: DiscoveryDto['kind'], score: number, status: DiscoveryDto['status'] = 'SUGGESTED'): DiscoveryDto => ({
  id: domain,
  catalogKey: domain,
  name: domain,
  domain,
  kind,
  countryCode: 'SA',
  currency: 'SAR',
  niches: [],
  score,
  reasons: [],
  status,
  competitorId: null,
});

describe('pickCompetitors', () => {
  it('prefers specialists and retailers over marketplaces, then higher overlap', () => {
    const picked = pickCompetitors([
      d('noon.com', 'MARKETPLACE', 99),
      d('a.sa', 'SPECIALIST', 60),
      d('b.sa', 'RETAILER', 80),
      d('c.sa', 'SPECIALIST', 70),
    ]);
    expect(picked.map((p) => p.domain)).toEqual(['b.sa', 'c.sa', 'a.sa']);
  });

  it('falls back to a marketplace when nothing else is left', () => {
    const picked = pickCompetitors([d('a.sa', 'SPECIALIST', 60), d('noon.com', 'MARKETPLACE', 99)]);
    expect(picked.map((p) => p.domain)).toEqual(['a.sa', 'noon.com']);
  });

  it('skips suggestions that were already handled and respects the limit', () => {
    const picked = pickCompetitors([d('a.sa', 'SPECIALIST', 90, 'ADDED'), d('b.sa', 'SPECIALIST', 50), d('c.sa', 'SPECIALIST', 40)], 1);
    expect(picked.map((p) => p.domain)).toEqual(['b.sa']);
  });

  it('breaks ties by domain so the choice is deterministic', () => {
    const picked = pickCompetitors([d('z.sa', 'RETAILER', 50), d('m.sa', 'RETAILER', 50)]);
    expect(picked.map((p) => p.domain)).toEqual(['m.sa', 'z.sa']);
  });
});
