/**
 * Read server-only env vars without Vite inlining them as undefined at build time.
 * Use bracket access: process.env["KEY"] survives bundling on Vercel/Nitro.
 */
export function readServerEnv(key: string): string {
  if (typeof process !== "undefined" && process.env) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}
