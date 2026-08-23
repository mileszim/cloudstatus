/**
 * Produces — and checks — the ADMIN_PASSWORD_HASH verifier for a password.
 *
 *   npm run hash-password                       # prompt (no echo, asks twice)
 *   npm run hash-password -- "correct horse"    # non-interactive
 *   npm run hash-password -- --check            # does .dev.vars accept a password?
 *   npm run hash-password -- --check 'pbkdf2$…' # does this verifier accept it?
 *
 * Mirrors lib/auth/password.ts — keep the two in step if the format changes.
 */
import { webcrypto as crypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

/**
 * Cloudflare Workers refuses more than this many PBKDF2 iterations per call, as
 * a DoS guard. Local workerd does NOT enforce it, so this script must — Node's
 * crypto happily derives at any count, and blessing a verifier here that
 * production cannot check is worse than not checking at all.
 *
 * Keep in step with MAX_ITERATIONS in lib/auth/password.ts.
 * @see https://github.com/cloudflare/workerd/issues/1346
 */
const MAX_ITERATIONS = 100_000;

const ITERATIONS = MAX_ITERATIONS;
const MIN_ITERATIONS = 1_000;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    KEY_LENGTH * 8,
  );
  return Buffer.from(bits);
}

async function hash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const digest = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${Buffer.from(salt).toString("base64")}$${digest.toString("base64")}`;
}

/** Same leniency as lib/auth/password.ts, so `--check` agrees with the running app. */
function normalise(verifier) {
  let value = verifier.trim().replace(/^ADMIN_PASSWORD_HASH\s*=\s*/, "").trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.length > 1 && value.endsWith(quote)) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

/** `{ ok }` or `{ error }` describing why the verifier itself is unusable. */
async function check(password, verifier) {
  const value = normalise(verifier);
  if (!value) return { error: "the value is empty" };

  const parts = value.split("$");
  if (parts.length !== 4) {
    return {
      error: `expected 4 \`$\`-separated fields, found ${parts.length} — the value is truncated, or it is a plain password rather than a verifier`,
    };
  }
  if (parts[0] !== "pbkdf2") {
    return { error: `expected the first field to be \`pbkdf2\`, found \`${parts[0]}\``};
  }

  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS) {
    return { error: `\`${parts[1]}\` is not an iteration count of at least ${MIN_ITERATIONS}` };
  }
  if (iterations > MAX_ITERATIONS) {
    return {
      error:
        `the iteration count is ${iterations}, above the ${MAX_ITERATIONS} that Cloudflare Workers will perform.\n` +
        `  This verifier can be checked here but never in production — regenerate it`,
    };
  }

  const salt = Buffer.from(parts[2], "base64");
  const expected = Buffer.from(parts[3], "base64");
  if (expected.length !== KEY_LENGTH) {
    return {
      error: `the digest decodes to ${expected.length} bytes, expected ${KEY_LENGTH} — the value is truncated`,
    };
  }

  return { ok: (await derive(password, salt, iterations)).equals(expected) };
}

/**
 * Asks for a password without echoing it.
 *
 * Typing it here rather than passing it on the command line is the reliable
 * route: a shell eats `$`, `!`, and backticks inside double quotes, so
 * `-- "p@ss$word"` hashes something other than what gets typed at sign-in.
 */
function askHidden(label) {
  return new Promise((resolve, reject) => {
    const tty = Boolean(process.stdin.isTTY);
    // Piped input is not being echoed to a screen, so read it plainly. That is
    // what makes `--check` usable from a script.
    const rl = tty
      ? createInterface({ input: process.stdin, output: process.stderr, terminal: true })
      : createInterface({ input: process.stdin });

    let answered = false;

    if (tty) {
      let masked = false;
      // readline has no masking option; suppressing its own echo is the
      // standard way. `masked` is set after question() so the prompt itself
      // still prints.
      rl._writeToOutput = (chunk) => {
        if (!masked) process.stderr.write(chunk);
      };
      rl.question(label, (answer) => {
        answered = true;
        process.stderr.write("\n");
        rl.close();
        resolve(answer);
      });
      masked = true;
    } else {
      rl.once("line", (line) => {
        answered = true;
        rl.close();
        resolve(line);
      });
    }

    // Ctrl-D, or a pipe that ended without a newline. Without this the promise
    // never settles and node exits on an unsettled top-level await instead of
    // saying anything useful.
    rl.once("close", () => {
      if (!answered) reject(new Error("No password was entered."));
    });
  });
}

function verifierFromDevVars() {
  let contents;
  try {
    contents = readFileSync(".dev.vars", "utf8");
  } catch {
    throw new Error("No .dev.vars in the current directory. Pass the verifier as an argument.");
  }
  const line = contents
    .split("\n")
    .find((l) => l.trimStart().startsWith("ADMIN_PASSWORD_HASH="));
  if (!line) throw new Error(".dev.vars has no ADMIN_PASSWORD_HASH line.");
  return line.trim();
}

const args = process.argv.slice(2);
const checking = args[0] === "--check";

// Every failure below is a message for a human, not a stack trace. Top-level
// await surfaces rejections as unhandled rejections, so both hooks are needed.
const die = (error) => {
  console.error(`\n${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
};
process.on("uncaughtException", die);
process.on("unhandledRejection", die);

if (checking) {
  const source = args[1] ? "the value you passed" : ".dev.vars";
  const verifier = args[1] ?? verifierFromDevVars();
  const password = await askHidden("Password to check: ");

  const result = await check(password, verifier);
  if (result.error) {
    console.error(`\n✗ The verifier in ${source} is unusable: ${result.error}.`);
    console.error("  Store only the `pbkdf2$…` value — no `ADMIN_PASSWORD_HASH=` prefix, no quotes.\n");
    process.exit(1);
  }
  if (!result.ok) {
    console.error(`\n✗ That password does not match the verifier in ${source}.\n`);
    process.exit(1);
  }
  console.error(`\n✓ That password matches the verifier in ${source}.\n`);
  process.exit(0);
}

let password = args[0];

if (password) {
  console.error(
    "Note: the shell may have altered a password containing $, !, or backticks.\n" +
      "      Run `npm run hash-password` with no argument to type it instead.\n",
  );
} else {
  password = await askHidden("Admin password: ");
  const again = await askHidden("Confirm password: ");
  if (password !== again) {
    console.error("Those did not match. Nothing was written.");
    process.exit(1);
  }
}

if (!password || password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const verifier = await hash(password);

// Never hand out a verifier that cannot read itself back.
const selfCheck = await check(password, verifier);
if (!selfCheck.ok) {
  console.error("Internal error: the generated verifier failed its own check. Nothing written.");
  process.exit(1);
}

console.error("\nLocal development — append this line to .dev.vars:\n");
console.log(`ADMIN_PASSWORD_HASH=${verifier}`);
console.error("\nProduction — paste ONLY the value below (no name, no quotes) when prompted by:");
console.error("  npx wrangler secret put ADMIN_PASSWORD_HASH\n");
console.error(`  ${verifier}\n`);
console.error("Then confirm it round-trips:  npm run hash-password -- --check\n");
