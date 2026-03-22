/** Geteilte Typen für ANNY-Sync (REST-Liste, JSON:API). */

export interface AnnyLineItem {
  id?: string | number;
  name?: string;
  title?: string;
  quantity?: number;
  price?: number | string;
  product?: { id?: string | number; name?: string; title?: string };
}

export interface AnnyBooking {
  id: string | number;
  /** QR-/Scan-Token (!TIX…); Buchungsnr. oft separat in `number` (z. B. BB…) */
  code?: string;
  number?: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  status?: string;
  created_at?: string;
  customer?: {
    id?: string | number;
    full_name?: string;
    name?: string;
    email?: string;
    first_name?: string;
    last_name?: string;
    given_name?: string;
    family_name?: string;
    birth_date?: string;
  };
  resource?: {
    id?: string | number;
    name?: string;
  };
  service?: {
    id?: string | number;
    name?: string;
  };
  subscription?: {
    id?: string | number;
    name?: string;
    title?: string;
  };
  /** Verknüpftes Ticket (JSON:API included), enthält oft QR-/Token-Felder */
  ticket?: Record<string, unknown>;
  line_items?: AnnyLineItem[];
  products?: AnnyLineItem[];
  extras?: AnnyLineItem[];
}
