export type Role = "user" | "assistant";

export interface Message {
  id: string;
  role: Role;
  text: string;
  imageUrl?: string;
  frontImageUrl?: string;
  backImageUrl?: string;
  createdAt: number;
  error?: boolean;
}

export interface Chat {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}
