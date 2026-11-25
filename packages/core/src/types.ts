/**
 * Domain types shared by the website and the iOS/Android apps.
 *
 * Nothing in this package may import React, next/*, react-native or any DOM or
 * native API. If a rule lives here, every platform gets the same behaviour.
 */

// ── Menu ─────────────────────────────────────────────────────────────────────

/** Which card a dish is printed on. The kitchen switches at 21:30. */
export type MenuService = 'kitchen' | 'afterhours';

export type MenuSectionId =
  | 'small-bites'
  | 'classics'
  | 'cheese-cuts'
  | 'starters'
  | 'salads'
  | 'land-sea'
  | 'sides'
  | 'sweet'
  | 'afterhours';

export interface MenuItem {
  id: string;
  name: string;
  /** Sub-line on the paper menu, e.g. "Caramelized onion Miso". */
  note?: string;
  /** Euros. A tuple is a range, as on "Iberico cold cuts 11/19". */
  price: number | readonly number[];
  /** Printed with an asterisk: served with crackers. */
  withCrackers?: boolean;
  /** Hidden from the public menu without deleting the record. */
  soldOut?: boolean;
  allergens?: readonly string[];
}

export interface MenuSection {
  id: MenuSectionId;
  title: string;
  service: MenuService;
  items: readonly MenuItem[];
}

// ── Wine ─────────────────────────────────────────────────────────────────────

export type WineColour = 'sparkling' | 'white' | 'orange' | 'rose' | 'red' | 'sweet';

export interface Wine {
  id: string;
  name: string;
  producer: string;
  colour: WineColour;
  country: string;
  region?: string;
  grapes?: readonly string[];
  vintage?: number;
  /** Euros per glass, when it is on the by-the-glass list. */
  glass?: number;
  /** Euros per bottle. */
  bottle: number;
  /** How it tastes, in the staff's words - shown on the list when written. */
  tastingNote?: string;
  /** Also sold across the road at CE-LLAR. */
  inShop?: boolean;
  staffPick?: boolean;
  /** Absent (as on the static list) means available - only the live cellar table ever sets this false. */
  available?: boolean;
}

// ── Bookings ─────────────────────────────────────────────────────────────────

export type BookingStatus = 'pending' | 'confirmed' | 'seated' | 'cancelled' | 'no_show';

/** Where a guest asked to sit. Matches `dining_tables.area` and `bookings.requested_area`. */
export type BookingArea = 'inside' | 'terrace' | 'bar';

export interface Booking {
  id: string;
  /** ISO date, `YYYY-MM-DD`, in Europe/Brussels. */
  date: string;
  /** 24h wall clock, `HH:mm`. */
  time: string;
  partySize: number;
  guestName: string;
  /** Absent for a phone booking staff took with no address on file. */
  guestEmail?: string;
  guestPhone?: string;
  notes?: string;
  status: BookingStatus;
  /**
   * The language the guest booked in, so a confirmation sent hours later still
   * arrives in the language they used.
   */
  locale?: 'en' | 'nl';
  createdAt: string;
  /** The primary table this booking is seated at, if one has been assigned. */
  tableId?: string;
  /**
   * The rest of the run - further tables pushed together with `tableId`
   * because the party did not fit on one. Set when the allocator combined a
   * run (two tables or more), or when staff joined tables by hand. Absent or
   * empty means the booking sits on `tableId` alone.
   */
  joinedTableIds?: string[];
  /**
   * Which specific seats at that table, 0-indexed in the same order the
   * floor plan draws them. Absent means the whole table - every booking
   * `book_table` allocates automatically, and any assigned before staff
   * could pick seats by hand.
   */
  seatIndices?: number[];
  /**
   * What the guest asked for, kept even when nothing was found - `book_table`
   * still records it on a `pending` row that has no `tableId` yet.
   */
  area?: BookingArea;
  /** The reservation reference, `TN-…`, assigned to every booking on creation. */
  refCode?: string;
  /** The cancellation reference, `TN-C-…`, set once the booking is cancelled. */
  cancelCode?: string;
}

/** A shared, staff-visible note for one service day - not tied to any one booking. */
export interface DayNote {
  date: string;
  note: string;
  updatedAt: string;
}

/** One tracked edit to a booking's operational shape - table, seats, status, time, or party size. */
export interface BookingChange {
  id: string;
  changedAt: string;
  /** The staff member's email, or absent for a guest-made change (a self-cancel, the booking form). */
  changedBy?: string;
  changes: Record<string, { old: unknown; new: unknown }>;
}

/** A day, or part of a day, the room is not open to the public. */
export interface Blackout {
  id: string;
  date: string;
  reason: string;
  /** Absent means the whole day is blocked. */
  from?: string;
  to?: string;
}

export interface ServiceWindow {
  /** 0 = Sunday … 6 = Saturday, matching `Date.prototype.getDay`. */
  weekday: number;
  opens: string;
  /** Doors shut. After midnight this reads `00:30`, i.e. the following day. */
  closes: string;
  /** Kitchen's last order - earlier than `closes`; the bar keeps going. */
  lastSeating: string;
}

// ── Shop ─────────────────────────────────────────────────────────────────────

export interface ShopProduct {
  id: string;
  wineId?: string;
  title: string;
  price: number;
  stock: number;
  /** Below this, the reorder mail is drafted. */
  reorderAt: number;
  supplier?: string;
}

export interface CartLine {
  productId: string;
  quantity: number;
}
