import type { User } from "@supabase/supabase-js";
import { z } from "zod";

export type UserRole = "worker" | "manager";

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email обязателен")
    .email("Некорректный email"),
  password: z.string().min(1, "Пароль не может быть пустым"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
};

export function getUserRole(user: User): UserRole | null {
  const metadataRole = user.user_metadata?.role;
  if (metadataRole === "worker" || metadataRole === "manager") {
    return metadataRole;
  }

  const email = user.email?.trim().toLowerCase();
  if (email === "worker@factory.com") return "worker";
  if (email === "manager@factory.com") return "manager";

  return null;
}

export function toAuthUser(user: User): AuthUser | null {
  const role = getUserRole(user);
  if (!role || !user.email) return null;

  return {
    id: user.id,
    email: user.email,
    role,
  };
}

export function getRedirectForRole(role: UserRole): "/worker" | "/manager" {
  return role === "worker" ? "/worker" : "/manager";
}

export function mapAuthError(message: string): string {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("invalid login credentials") ||
    normalized.includes("invalid email or password")
  ) {
    return "Неверный email или пароль";
  }

  if (normalized.includes("email not confirmed")) {
    return "Подтвердите email перед входом";
  }

  return "Неверный email или пароль";
}
