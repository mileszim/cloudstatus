/**
 * Produces the ADMIN_PASSWORD_HASH verifier for a password.
 *
 *   npm run hash-password -- "correct horse battery staple"
 *
 * Mirrors lib/auth/password.ts — keep the two in step if the format changes.
 */
import { webcrypto as crypto } from "node:crypto";
import { createInterface } from "node:readline/promises";

const ITERATIONS = 210_000;
const KEY_LENGTH = 32;

async function hash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
    key,
    KEY_LENGTH * 8,
  );
  const b64 = (bytes) => Buffer.from(bytes).toString("base64");
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

let password = process.argv[2];

if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  password = await rl.question("Admin password: ");
  rl.close();
}

if (!password || password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const verifier = await hash(password);

console.error("\nAdd this to .dev.vars for local development:\n");
console.log(`ADMIN_PASSWORD_HASH=${verifier}`);
console.error("\nAnd for production:\n");
console.error(`  npx wrangler secret put ADMIN_PASSWORD_HASH\n`);
