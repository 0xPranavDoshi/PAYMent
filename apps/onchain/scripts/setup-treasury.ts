/**
 * One-time Circle treasury setup for Arc Testnet.
 *
 *   pnpm --filter @copayme/onchain setup:treasury
 *
 * Steps (idempotent except entity-secret registration, which runs once):
 *   1. Ensure an Entity Secret (generate + register + download recovery file if missing).
 *   2. Create a Wallet Set + an EOA wallet on ARC-TESTNET = the treasury vault.
 *   3. Request testnet USDC + native from the Circle faucet.
 *   4. Print the .env lines to paste.
 *
 * Needs CIRCLE_API_KEY in .env. Everything prints what to add to .env next.
 */
import { randomBytes } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { ARC_TESTNET, explorerAddress } from "../src/config.js";

const ENV_PATH = "../../.env"; // repo root, relative to apps/onchain cwd

const spec = "@circle-fin/developer-controlled-wallets";
const sdk: any = await import(spec).catch(() => {
  console.error(`Missing dependency. Run:\n  pnpm --filter @copayme/onchain add ${spec}`);
  process.exit(1);
});

const apiKey = process.env.CIRCLE_API_KEY;
if (!apiKey) {
  console.error("CIRCLE_API_KEY is not set (see .env.example). Get a testnet key at console.circle.com.");
  process.exit(1);
}

function dig(obj: any, ...paths: string[][]): any {
  for (const path of paths) {
    let cur = obj;
    let ok = true;
    for (const key of path) {
      cur = cur?.[key];
      if (cur === undefined) { ok = false; break; }
    }
    if (ok) return cur;
  }
  return undefined;
}

// ── 1. Entity secret ──────────────────────────────────────────────────────────
let entitySecret = process.env.CIRCLE_ENTITY_SECRET;
const envLines: string[] = [];
if (!entitySecret) {
  entitySecret = randomBytes(32).toString("hex");
  // Save to .env BEFORE any network call so the secret can never be lost mid-registration.
  await appendFile(ENV_PATH, `\nCIRCLE_ENTITY_SECRET=${entitySecret}\n`);
  console.log("Generated a new entity secret and saved it to .env (CIRCLE_ENTITY_SECRET).");
  try {
    // recoveryFileDownloadPath is a DIRECTORY; the SDK writes recovery_file_<uuid>.dat into it.
    await sdk.registerEntitySecretCiphertext({ apiKey, entitySecret, recoveryFileDownloadPath: "." });
    console.log("Registered entity secret; recovery file written to apps/onchain/ (gitignored).");
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (/already|registered|exist/i.test(msg)) {
      console.error(
        "\nAn entity secret is ALREADY registered for this Circle account, and it is not the one just saved.\n" +
          "Reset it in the Circle Console (Configurator → reset entity secret), remove the CIRCLE_ENTITY_SECRET\n" +
          "line just added to .env, and re-run this script.\n",
      );
    } else {
      console.error("Entity secret registration failed (the secret is saved in .env):", err);
    }
    process.exit(1);
  }
} else {
  console.log("Using existing CIRCLE_ENTITY_SECRET (assuming already registered).");
}

const client = sdk.initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

// ── 2. Wallet set + EOA wallet on Arc Testnet ───────────────────────────────────
const wsRes = await client.createWalletSet({ name: "copayme-treasury" });
const walletSetId = dig(wsRes, ["data", "walletSet", "id"], ["data", "walletSets", "0", "id"]);
if (!walletSetId) throw new Error("could not read walletSetId from createWalletSet response");
console.log(`Wallet set: ${walletSetId}`);

const wRes = await client.createWallets({
  walletSetId,
  blockchains: [ARC_TESTNET.circleBlockchain],
  accountType: "EOA",
  count: 1,
});
const wallet = dig(wRes, ["data", "wallets", "0"]);
if (!wallet?.address) throw new Error("could not read wallet from createWallets response");
console.log(`Treasury wallet ${wallet.id}\n  ${wallet.address}\n  ${explorerAddress(wallet.address)}`);
envLines.push(`TREASURY_WALLET_ID=${wallet.id}`);
envLines.push(`TREASURY_WALLET_ADDRESS=${wallet.address}`);

// ── 3. Faucet ───────────────────────────────────────────────────────────────────
try {
  await client.requestTestnetTokens({
    address: wallet.address,
    blockchain: ARC_TESTNET.circleBlockchain,
    usdc: true,
    native: true,
  });
  console.log("Requested testnet USDC + native from the Circle faucet (may take a minute to arrive).");
} catch (err) {
  console.warn("Faucet request failed — fund manually at https://faucet.circle.com (Arc Testnet):", err);
}

// ── 4. Output ─────────────────────────────────────────────────────────────────
await appendFile(ENV_PATH, "\n" + envLines.join("\n") + "\n");
console.log("\nSaved to .env:\n" + envLines.join("\n"));
console.log(
  "\nFlip PAYMENT_PROVIDER=wallet in .env to make real Arc USDC transfers.\n" +
    "For the gasless x402 path, also set TREASURY_PRIVATE_KEY and run the Gateway deposit (see README).",
);
