import type { RouterRow } from "@/lib/types";

/** Router row safe to send to the browser: credentials never leave the server. */
export function publicRouter(row: RouterRow) {
  const { password_enc, agent_token_hash, ...rest } = row;
  return { ...rest, has_password: Boolean(password_enc), has_agent_token: Boolean(agent_token_hash) };
}

export type PublicRouter = ReturnType<typeof publicRouter>;
