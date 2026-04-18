// API response shapes. We keep these as plain TS types (not Prisma model
// re-exports) so the client doesn't pull `@prisma/client` into its bundle
// and so the wire shape can diverge from the DB shape (timestamps as
// numbers, omitted internal columns, etc.).

import type { Role as ClientRole } from "./types";

export type Role = ClientRole | "system";

export interface MessageDTO {
  id: string;
  chatId: string;
  role: Role;
  text: string;
  // `imageUrl` is the primary (front) view and is kept for back-compat with
  // single-image consumers. `frontImageUrl` / `backImageUrl` are the full
  // pair — every assistant turn now renders both views.
  imageUrl?: string;
  frontImageUrl?: string;
  backImageUrl?: string;
  ordering: number;
  error: boolean;
  createdAt: number; // epoch ms
}

export interface ChatSummaryDTO {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatDTO extends ChatSummaryDTO {
  messages: MessageDTO[];
}

export interface UserDTO {
  id: string;
  email: string | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
  gender: string | null;
  bodyType: string | null;
  size: string | null;
  heightCm: number | null;
  weightKg: number | null;
  favoriteColors: string[];
  styleTags: string[];
  preferences: Record<string, unknown>;
  monthlyQuota: number;
  creditsBalance: number;
  createdAt: number;
}

export interface WardrobeItemDTO {
  id: string;
  name: string;
  category: string;
  color: string | null;
  brand: string | null;
  size: string | null;
  season: string | null;
  tags: string[];
  notes: string | null;
  assetId: string | null;
  assetUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface FavoriteDTO {
  id: string;
  generatedImageId: string;
  imageUrl: string;
  label: string | null;
  createdAt: number;
}

export interface AssetDTO {
  id: string;
  url: string;
  kind: string;
  mimeType: string | null;
  sizeBytes: number | null;
  label: string | null;
  createdAt: number;
}
