"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { explainFailure, verifyPassword } from "@/lib/auth/password";
import {
  SESSION_COOKIE,
  createSessionCookieValue,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { secret } from "@/lib/secrets";

export interface LoginState {
  error?: string;
}

/** Where to send the user after a successful sign-in. Same-origin paths only. */
function safeRedirect(next: FormDataEntryValue | null): string {
  const value = typeof next === "string" ? next : "";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/admin";
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  // A cold isolate that cannot reach the secret store fails closed by design
  // (see lib/secrets.ts). Letting that reject here would surface as a bare 500
  // on the sign-in form, which says nothing about why.
  let verifier: string | undefined;
  let signing: string | undefined;
  try {
    [verifier, signing] = await Promise.all([
      secret("ADMIN_PASSWORD_HASH"),
      secret("SESSION_SECRET"),
    ]);
  } catch (error) {
    console.error("[login] could not resolve secrets", error);
    return {
      error:
        "Could not read this deployment's secrets, so sign-in cannot be checked. Retry in a moment; if it persists, check SEEKRIT_TOKEN and the seekrit API.",
    };
  }

  if (!verifier) {
    return {
      error:
        "No admin password is configured. Run `npm run hash-password` and set ADMIN_PASSWORD_HASH.",
    };
  }
  if (!signing) {
    return { error: "SESSION_SECRET is not set, so sessions cannot be signed." };
  }

  const password = formData.get("password");
  if (typeof password !== "string" || password.length === 0) {
    return { error: "Enter your password." };
  }

  const result = await verifyPassword(password, verifier);

  if (!result.ok) {
    if (result.reason === "mismatch") {
      return { error: "That password is not correct." };
    }

    // The stored verifier itself is unusable, so no password could ever work
    // here. Saying "not correct" would send the operator looking for a typo
    // that does not exist — this page is admin-only and the message names no
    // secret value, so it reports the real problem instead.
    const detail = explainFailure(result.reason);
    console.error(`[login] ADMIN_PASSWORD_HASH is unusable: ${detail}`);
    return {
      error: `The configured admin password cannot be checked: ${detail}. Re-run \`npm run hash-password\` and store only the verifier itself.`,
    };
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionCookieValue(), sessionCookieOptions());

  redirect(safeRedirect(formData.get("next")));
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/admin/login");
}
