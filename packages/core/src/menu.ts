import type { MenuSection, MenuItem, MenuService } from './types';

/**
 * The printed cards, transcribed.
 *
 * This is the seed for the `menu_sections` / `menu_items` tables. Once Supabase
 * is live the app reads from the database and Tawat edits it from the admin -
 * this stays as the fallback so the site still renders if the network is down.
 */
export const MENU: readonly MenuSection[] = [
  {
    id: 'small-bites',
    title: 'Small bites',
    service: 'kitchen',
    items: [
      { id: 'almonds', name: 'Salt pepper & smoked almonds', price: 5.5 },
      { id: 'gordal', name: 'Gordal olives', note: 'from Priorat, Spain', price: 5.5 },
      { id: 'bread', name: 'Bread & butter', note: 'Caramelized onion miso', price: 5.5 },
      { id: 'hummus', name: 'Hummus tandoori', note: 'Papadums', price: 13 },
      { id: 'padron', name: 'Pimientos de Padrón', note: 'Sea salt flakes', price: 12 },
    ],
  },
  {
    id: 'classics',
    title: 'Ta-nnin classics',
    service: 'kitchen',
    items: [
      { id: 'crispy-chicken', name: 'Japanese crispy chicken', note: 'Yellow sriracha dressing', price: 16 },
      { id: 'gyoza', name: 'Korean beef gyoza', note: 'Okonomiyaki sauce', price: 15 },
      { id: 'cheese-croquette', name: 'Cheese croquette', note: 'Herve - parmesan', price: 13 },
      { id: 'tannin-croquette', name: 'Ta-nnin croquette', note: 'Ibérico - pulled pork', price: 14 },
    ],
  },
  {
    id: 'cheese-cuts',
    title: 'Cheese & cuts',
    service: 'kitchen',
    items: [
      { id: 'cheese-platter', name: 'Cheese platter', note: 'Selected by Van Tricht', price: 19 },
      { id: 'coldcut-platter', name: 'Cold cut platter', note: 'Selected charcuterie', price: 19 },
      { id: 'mixed-platter', name: 'Mixed platter', note: 'Charcuterie & cheese', price: 22 },
      { id: 'secreto', name: 'The famous Secreto 07', note: 'De Laet & Van Haver, 100 gram', price: 21 },
    ],
  },
  {
    id: 'starters',
    title: 'Tasty starters',
    service: 'kitchen',
    items: [
      { id: 'duck-salad', name: 'Crispy duck salad', note: 'Sesame dressing - crispy mie', price: 16 },
      { id: 'burnt-tuna', name: 'Burnt tuna', note: 'Ponzu - furikake - avocado', price: 17 },
      { id: 'tartare', name: 'Steak tartare', note: 'Egg yolk', price: 17 },
      { id: 'artichoke', name: 'Artichoke flower', note: 'Mustard vinaigrette', price: 12 },
      { id: 'focaccia', name: 'Focaccia mortadella', note: 'Pistachio pesto - stracciatella', price: 14 },
    ],
  },
  {
    id: 'salads',
    title: 'Not just a side salad',
    service: 'kitchen',
    items: [
      { id: 'saveur', name: "Saveur d'antan", note: 'Tomato water - basil - avocado', price: 10 },
      { id: 'chicory', name: 'Chicory', note: 'Mustard - apple', price: 8 },
      { id: 'lettuce', name: 'Crispy lettuce', note: 'Pickled shallot - chives', price: 7 },
    ],
  },
  {
    id: 'land-sea',
    title: 'From land & sea',
    service: 'kitchen',
    items: [
      { id: 'tagliata', name: 'Tagliata carima ± 300gr', note: 'Entrecôte - chimichurri', price: 34 },
      { id: 'gambas', name: "Gamba's à la plancha", note: 'Chili - garlic', price: 18 },
      { id: 'salmon', name: 'Spicy salmon', note: 'Thai laab style', price: 17 },
      { id: 'mussels', name: 'Steamed mussels', note: 'Thai style', price: 19 },
      { id: 'pluma', name: 'Ibérico pluma ± 350gr', note: 'Belgian pickles', price: 28 },
      { id: 'tagliolini', name: 'Tagliolini al limone', note: 'Lemon basil sauce', price: 18 },
    ],
  },
  {
    id: 'sides',
    title: 'Crispy & comforting sides',
    service: 'kitchen',
    items: [
      { id: 'fries', name: 'Potato fries', note: 'Homemade mayo - mustard seeds', price: 12 },
      { id: 'sweet-fries', name: 'Sweet potato fries', note: 'Truffle mayo - parmesan', price: 12 },
    ],
  },
  {
    id: 'sweet',
    title: 'Sweet treats',
    service: 'kitchen',
    items: [
      { id: 'tanninmisu', name: 'Tanninmisu', price: 7 },
      { id: 'posset', name: 'Lemon posset', note: 'Crumble - pineapple', price: 8.5 },
    ],
  },
  {
    id: 'afterhours',
    title: 'The afterhours menu',
    service: 'afterhours',
    items: [
      { id: 'ah-almonds', name: 'Salt pepper & smoked almonds', price: 5.5 },
      { id: 'ah-gordal', name: 'Gordal olives', note: 'From Priorat, Spain', price: 5.5 },
      { id: 'ah-hummus', name: 'Hummus tandoori', price: 9, withCrackers: true },
      { id: 'ah-cheese', name: 'Cheese from Van Tricht', note: 'Ask our selection', price: 13, withCrackers: true },
      { id: 'ah-coldcuts', name: 'Ibérico cold cuts', note: 'Ask our selection', price: [11, 16, 19], withCrackers: true },
      { id: 'ah-salame', name: 'Salame market', note: 'Ask our flavors', price: 9, withCrackers: true },
      { id: 'ah-sardinha', name: 'Sardinha', note: 'Different flavors', price: 9.5 },
      { id: 'ah-tanninmisu', name: 'Tanninmisu', price: 7 },
      { id: 'ah-posset', name: 'Lemon posset', price: 8.5 },
    ],
  },
];

/** Printed on the card, and the moment the kitchen stops. */
export const LAST_CALL_KITCHEN = '21:30';

export const AFTERHOURS_STRAPLINE = 'For the better tomorrow';

export const AFTERHOURS_FOOTNOTE = 'Dishes marked with an asterisk are served with crackers.';

export function sectionsFor(service: MenuService): readonly MenuSection[] {
  return MENU.filter((s) => s.service === service);
}

/**
 * Which card is being served at `at`, in Europe/Brussels.
 *
 * The web app and the native apps both call this, so the site can never claim
 * the kitchen is open while the app says it is closed.
 */
export function serviceAt(at: Date = new Date()): MenuService {
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Brussels',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
  return hhmm >= LAST_CALL_KITCHEN ? 'afterhours' : 'kitchen';
}

/** `5.5` → `"5,5"`, matching the printed card and Belgian convention. */
export function formatPrice(price: MenuItem['price']): string {
  const one = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '').replace('.', ','));
  return Array.isArray(price) ? price.map(one).join(' / ') : one(price as number);
}
