/**
 * The bar list - everything poured by the glass.
 *
 * Source: the one2three menu the QR code on the table card points at. That list
 * is the live one and it moves week to week, so treat this file as a snapshot
 * taken 4 August 2026, not as the truth. It exists so the site renders the real
 * thing today; the moment the admin is wired up, this becomes the seed and the
 * database becomes the source.
 *
 * Tasting notes are only carried where the source showed them in full. Roughly
 * half were clipped behind a "read more", and half a sentence is worse than
 * none - those wines are listed without a note rather than with a fragment.
 */

export type DrinkCategory =
  | 'sparkling'
  | 'rose'
  | 'orange'
  | 'white'
  | 'chilled-red'
  | 'red'
  | 'beer'
  | 'sober'
  | 'cocktails'
  | 'skinny'
  | 'gin'
  | 'digestives'
  | 'spirits'
  | 'soft';

export interface Drink {
  name: string;
  /** Region, producer detail, or what is in the glass. */
  note?: string;
  /** Euros, by the glass or by the serve. */
  price: number;
  soldOut?: boolean;
}

export interface DrinkSection {
  id: DrinkCategory;
  title: string;
  /** True for the sections that are wine, so the site can show them together. */
  isWine?: boolean;
  items: readonly Drink[];
}

export const BAR_LIST: readonly DrinkSection[] = [
  {
    id: 'sparkling',
    title: 'Sparkling',
    isWine: true,
    items: [
      { name: 'Mont Marçal - Cava Reserva Brut', note: 'Spain · Macabeo, Parellada, Xarel·lo', price: 7.5 },
      { name: 'Ta-nnin Label Brut', note: 'Champagne, France · Pinot Noir, Chardonnay', price: 12.9 },
      { name: 'Gabernik 23 - PetNat Rosé', note: 'Štajerska, Slovenia', price: 9.4 },
    ],
  },
  {
    id: 'rose',
    title: 'Rosé',
    isWine: true,
    items: [
      { name: "Belles du Sud - L'Îlot", note: 'Sables de Camargue, France · Cinsault, Grenache', price: 7.1 },
      { name: '2024 António Maçanita - Rosé Vulcânico', note: 'Azores, Portugal', price: 9.7 },
    ],
  },
  {
    id: 'orange',
    title: 'Orange',
    isWine: true,
    items: [
      { name: 'Altolandon - Mil Historias', note: 'Manchuela, Spain · Macabeu, Moscatel', price: 7.9 },
      { name: 'Ta-Orange - Nikolaevo', note: 'Thracian Valley, Bulgaria · the house orange', price: 11.9 },
    ],
  },
  {
    id: 'white',
    title: 'White',
    isWine: true,
    items: [
      { name: 'Tokaj-Hétszőlő - Dry Furmint', note: 'Tokaj, Hungary', price: 8.5 },
      { name: 'Battenfeld-Spanier - Grüner Sylvaner Reserve Trocken', note: 'Rheinhessen, Germany', price: 10.9 },
      { name: 'Idiom - Viognier', note: 'Stellenbosch, South Africa', price: 9.5 },
      { name: "Vincent Prunier - Bourgogne Côte d'Or Chardonnay", note: 'Burgundy, France', price: 12.5 },
      { name: 'Philipp Kuhn - vom Kalkmergel Chardonnay', note: 'Pfalz, Germany', price: 11 },
      { name: 'Vin de Liège - Les Éolides', note: 'Wallonia, Belgium · organic field blend', price: 9.5 },
      { name: 'Zestos Blanco', note: 'Vinos de Madrid, Spain · Malvar, Airén', price: 7.5 },
      { name: 'Vignoble du Rêveur - Vigne en Rose', note: 'Alsace, France · Gewurztraminer, Riesling', price: 10.9 },
    ],
  },
  {
    id: 'chilled-red',
    title: 'Chilled red',
    isWine: true,
    items: [
      { name: "Niepoort - Nat'Cool", note: 'Dão, Portugal · light, juicy, low intervention', price: 7.5 },
      { name: 'Klopfer - Lemberger Trocken', note: 'Württemberg, Germany', price: 7.5 },
    ],
  },
  {
    id: 'red',
    title: 'Red',
    isWine: true,
    items: [
      { name: 'Dom. Machard de Gramont - Pinot Noir', note: 'Burgundy, France', price: 11 },
      { name: 'Idiom - Zinfandel', note: 'Stellenbosch, South Africa', price: 9.5 },
      { name: 'Lothian - Horny Owl Pinot Noir', note: 'Elgin, South Africa', price: 8.5 },
      { name: 'Ferdinand Matjaž Četrtič - Cabernet Sauvignon', note: 'Goriška Brda, Slovenia', price: 8.5 },
      { name: 'Les Éclats de Branas Grand Poujeaux', note: 'Moulis-en-Médoc, Bordeaux, France', price: 7.7 },
      { name: 'Domaine de la Marfée - Les Gamines', note: 'Languedoc, France', price: 8.8 },
    ],
  },
  {
    id: 'beer',
    title: 'Beers',
    items: [
      { name: "IJwit", note: 'Amsterdam brewery', price: 5.9 },
      { name: 'Tank 7', price: 5.5 },
      { name: 'Duvel', price: 5.5 },
      { name: "Tripel d'Anvers", price: 5.5 },
      { name: 'Bavik Super Pils', price: 3.2 },
      { name: 'Duchesse de Bourgogne', note: 'West-Flemish red brown ale', price: 6.5 },
      { name: 'Tipsy Silver', note: '0% · Belgian alcohol-free blond', price: 5.5 },
      { name: "Unplugged - 't Verzet", note: '0% · alcohol-free hazy IPA', price: 5.5 },
    ],
  },
  {
    id: 'cocktails',
    title: 'Cocktails',
    items: [
      { name: 'Aperol Spritz', price: 9.7 },
      { name: 'Campari Spritz', price: 11 },
      { name: 'Verveine Sparkler', note: 'Verveine brut syrup, sparkling wine, sparkling water', price: 10.5 },
      { name: 'Negroni', price: 13.5 },
      { name: 'Moscow Mule', price: 13.5 },
      { name: 'Dark & Stormy', price: 13.5 },
      { name: 'Porn Star Martini', price: 13.5 },
      { name: 'Espresso Martini', price: 13.5 },
      { name: 'Lazy Red Cheeks', note: 'Vodka, raspberry, violet, lime, cane sugar', price: 13.5 },
      { name: 'Lilo Negroni', note: 'Grilled pineapple tequila, Amaro Montenegro, limoncello', price: 14 },
      { name: 'Lilo Mai Tai', note: 'Mandarinetto, amaretto, gin, lemon', price: 14 },
    ],
  },
  {
    id: 'skinny',
    title: 'Skinny list',
    items: [
      { name: 'Skinny Bitch', note: 'Vodka, lime juice, sparkling water', price: 12.5 },
      { name: 'Skinny Mule', note: 'Vodka, ginger & lemon kombucha', price: 13.5 },
      { name: 'Skinny Stormy', note: 'Dark rum, ginger & lemon kombucha', price: 13.5 },
    ],
  },
  {
    id: 'sober',
    title: 'Sober list',
    items: [
      { name: 'Sober Dark & Stormy', note: '0% rum, lime, ginger beer', price: 11 },
      { name: 'Copperhead 0.0 Gin & Tonic', price: 11 },
      { name: 'Sober Lazy Red Cheeks', note: 'Raspberry, violet, lime, cane sugar, sparkling water', price: 11 },
      { name: 'Paloma', note: 'Blood orange, grapefruit, chili, sparkling water', price: 11 },
      { name: 'Spicy Mule', note: 'Ginger, lime', price: 11 },
      { name: 'Crodino N.A. with tonic', price: 9.5 },
      { name: 'Crodino N.A.', price: 5.7 },
    ],
  },
  {
    id: 'gin',
    title: "Gin o'clock",
    items: [
      { name: 'The Perfect Bulldog', price: 13 },
      { name: 'Marula Pomegranate', price: 13.5 },
      { name: 'Gin Mare', price: 15 },
      { name: 'Copperhead', price: 15 },
      { name: 'Antverpia', price: 15 },
    ],
  },
  {
    id: 'digestives',
    title: 'Digestives',
    items: [
      { name: 'Andresen 10 Year Old White Port', price: 8.5 },
      { name: 'Amaretto', price: 7.5 },
      { name: 'Limoncello', note: 'On the rocks', price: 7 },
      { name: 'Limoncello', note: 'Shot', price: 5 },
      { name: 'Maderista - Madeira Reserva Dry', price: 0, soldOut: true },
    ],
  },
  {
    id: 'spirits',
    title: 'Spirits',
    items: [
      { name: 'Belvedere Vodka', price: 11 },
      { name: 'Mezcal Del Maguey Vida', price: 11 },
      { name: 'Talisker 10Y', price: 11 },
      { name: 'Wild Turkey 101', price: 9 },
      { name: 'Bushmills', price: 9 },
      { name: 'Campari on the rocks', price: 7.5 },
    ],
  },
  {
    id: 'soft',
    title: 'Soft drinks',
    items: [
      { name: 'Chaudfontaine still', note: '250ml', price: 3.17 },
      { name: 'Chaudfontaine sparkling', note: '250ml', price: 3.2 },
      { name: 'Chaudfontaine still', note: '500ml', price: 6.2 },
      { name: 'Chaudfontaine sparkling', note: '500ml', price: 6.2 },
      { name: 'Coca-Cola', price: 3.7 },
      { name: 'Coca-Cola Zero', price: 3.7 },
      { name: 'Sprite', price: 3.7 },
      { name: 'Ice tea', price: 3.7 },
      { name: 'Fever-Tree Mediterranean tonic', price: 4.2 },
      { name: 'Fever-Tree ginger beer', price: 4.2 },
      { name: 'JARR ginger kombucha', price: 5.9 },
    ],
  },
];

/** When this snapshot was taken, so the site can be honest about it. */
export const BAR_LIST_UPDATED = '2026-08-04';

export const GLASS_SECTIONS = BAR_LIST.filter((s) => s.isWine);
export const BAR_SECTIONS = BAR_LIST.filter((s) => !s.isWine);

/** `7.5` → `"7,50"` - Belgian convention, two places, as the bar prints it. */
export function formatDrinkPrice(price: number): string {
  return price.toFixed(2).replace('.', ',');
}
