import { describe, expect, it } from 'vitest';
import { repairEncoding, resolveWineOrigin } from './origin';
import { WINES } from './wines';

describe('resolveWineOrigin', () => {
  it('leaves a row that is already correct alone', () => {
    expect(resolveWineOrigin({ country: 'France', region: 'Champagne' })).toEqual({
      country: 'France',
      region: 'Champagne',
      ambiguous: false,
    });
  });

  it('moves a region out of the country field and looks the country up', () => {
    // The bug this exists for: "Burgundy" was filed as a country, so filtering
    // by France missed the wine entirely.
    expect(resolveWineOrigin({ country: 'Burgundy' })).toEqual({
      country: 'France',
      region: 'Burgundy',
      ambiguous: false,
    });
  });

  it('keeps the useful half of a bracketed designation', () => {
    expect(resolveWineOrigin({ country: 'Vin de France (Rhône)' })).toEqual({
      country: 'France',
      region: 'Rhône',
      ambiguous: false,
    });
  });

  it('resolves accented and appellation-level origins', () => {
    expect(resolveWineOrigin({ country: 'Aragón' }).country).toBe('Spain');
    expect(resolveWineOrigin({ country: 'Penedès' }).country).toBe('Spain');
    expect(resolveWineOrigin({ country: 'Dão' }).country).toBe('Portugal');
    expect(resolveWineOrigin({ country: 'Niederösterreich' }).country).toBe('Austria');
    expect(resolveWineOrigin({ country: 'Auxey-Duresses' }).country).toBe('France');
    expect(resolveWineOrigin({ country: 'Rosso Di Montalcino' }).country).toBe('Italy');
  });

  it('files Cyprus and Slovakia as countries', () => {
    expect(resolveWineOrigin({ country: 'Cyprus' })).toMatchObject({
      country: 'Cyprus',
      ambiguous: false,
    });
    expect(resolveWineOrigin({ country: 'Slovakia', region: 'Malé Karpaty' })).toEqual({
      country: 'Slovakia',
      region: 'Malé Karpaty',
      ambiguous: false,
    });
  });

  it('refuses to guess an origin that names two countries', () => {
    const r = resolveWineOrigin({ country: 'Slovenia x Italy' });
    expect(r.country).toBeNull();
    expect(r.ambiguous).toBe(true);
  });

  it('refuses to guess Macedonia, which is both a country and a Greek region', () => {
    expect(resolveWineOrigin({ country: 'Macedonia' })).toMatchObject({
      country: null,
      ambiguous: true,
    });
  });

  it('does not invent a country for a place it has never seen', () => {
    expect(resolveWineOrigin({ country: 'Somewhere Nobody Listed' })).toMatchObject({
      country: null,
      ambiguous: true,
    });
  });

  it('resolves every bottle in the printed cellar except the known-ambiguous ones', () => {
    const unresolved = WINES.filter((w) => resolveWineOrigin(w).country === null).map(
      (w) => w.country,
    );
    // Only the genuinely undecidable ones may remain, and they must be flagged
    // rather than filed under a guess.
    expect([...new Set(unresolved)].sort()).toEqual(['Macedonia', 'Slovenia x Italy']);
  });

  it('offers countries only, once each', () => {
    const countries = new Set(
      WINES.map((w) => resolveWineOrigin(w).country).filter((c): c is string => c !== null),
    );
    // The old filter offered 69 options mixing countries with regions.
    expect(countries.size).toBeLessThan(25);
    expect(countries.has('Burgundy')).toBe(false);
    expect(countries.has('France')).toBe(true);
  });
});

describe('repairEncoding', () => {
  it('repairs the em dash that came back as mojibake', () => {
    expect(repairEncoding('Les Longeroies â€” Marsannay')).toBe('Les Longeroies - Marsannay');
  });

  it('repairs accented characters', () => {
    expect(repairEncoding('CÃ´tes du RhÃ´ne')).toBe('Côtes du Rhône');
  });

  it('leaves correct text exactly as it is', () => {
    expect(repairEncoding('Côtes du Rhône')).toBe('Côtes du Rhône');
    expect(repairEncoding('Les Longeroies - Marsannay')).toBe('Les Longeroies - Marsannay');
  });

  it('passes null and undefined through', () => {
    expect(repairEncoding(null)).toBeNull();
    expect(repairEncoding(undefined)).toBeUndefined();
  });
});
