import { describe, expect, it } from 'vitest';
import { applyOverrides, checkText, DEFAULT_MESSAGES, flatten, placeholders, slugify, textSections } from './index';

describe('applyOverrides', () => {
  it('replaces one text in one language and leaves the rest', () => {
    const out = applyOverrides(DEFAULT_MESSAGES.nl, { 'about.heading': { nl: 'Nieuwe titel', en: 'New title' } }, 'nl');
    expect(flatten(out)['about.heading']).toBe('Nieuwe titel');
    expect(flatten(out)['about.eyebrow']).toBe(flatten(DEFAULT_MESSAGES.nl)['about.eyebrow']);
    expect(flatten(DEFAULT_MESSAGES.nl)['about.heading']).not.toBe('Nieuwe titel');
  });

  it('ignores empty values, unknown keys and keys that name a group', () => {
    const out = applyOverrides(DEFAULT_MESSAGES.en, { 'about.heading': { en: '  ' }, 'nope.gone': { en: 'x' }, about: { en: 'x' } }, 'en');
    expect(out).toEqual(DEFAULT_MESSAGES.en);
  });

  it('fills a text missing from the French file', () => {
    const en = flatten(DEFAULT_MESSAGES.en);
    const fr = flatten(DEFAULT_MESSAGES.fr);
    const missing = Object.keys(en).find((k) => !(k in fr));
    if (!missing) return;
    const out = applyOverrides(DEFAULT_MESSAGES.fr, { [missing]: { fr: 'Bonjour' } }, 'fr');
    expect(flatten(out)[missing]).toBe('Bonjour');
  });
});

describe('checkText', () => {
  it('wants the same placeholders back', () => {
    expect(placeholders('{count, plural, one {# bottle} other {# bottles}} by {name}')).toEqual(['count', 'name']);
    expect(checkText('Hi {name}', 'Hallo {name}')).toBeNull();
    expect(checkText('Hi {name}', 'Hallo')).toMatch(/\{name\}/);
    expect(checkText('Hi', 'Hallo {who}')).toMatch(/\{who\}/);
    expect(checkText('Hi {name}', 'Hallo {name')).toMatch(/match/);
  });
});

describe('textSections', () => {
  it('lists every visible text once, notes for translators left out', () => {
    const keys = textSections().flatMap((s) => s.texts.map((t) => t.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.some((k) => k.includes('._'))).toBe(false);
    expect(keys).toContain('about.heading');
  });
});

it('slugify', () => {
  expect(slugify('Privé Events!')).toBe('prive-events');
});
