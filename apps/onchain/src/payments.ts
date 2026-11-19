import { ARC_TESTNET } from "./config.js";

/**
 * Abstraction over "move USDC on Arc". The app never talks to Circle directly;
 * it calls payCreator (vault → creator reward) and redeemTo (accrued balance →
 * user's wallet). This keeps the HTTP layer testable with the mock provider and
 * lets us swap the on-chain path via the PAYMENT_PROVIDER env flag.
 */
export interface PaymentProvider {
  readonly kind: "mock" | "wallet" | "x402";
  /** Pay a creator from the treasury vault. Returns the Arc settlement tx hash. */
  payCreator(toAddress: string, amountUsdc: number, memo?: string): Promise<{ txHash: string }>;
  /** Redeem: send a user's accrued USDC to their connected wallet. Returns the tx hash. */
  redeemTo(toAddress: string, amountUsdc: number, memo?: string): Promise<{ txHash: string }>;
}

/**
 * Deterministic in-memory provider. The default so the whole service runs, tests,
 * and demos without any Circle credentials. Produces plausible-looking tx hashes.
 */
export function createMockPaymentProvider(): PaymentProvider {
  let n = 0;
  const fakeTx = () =>
    "0x" + (++n).toString(16).padStart(8, "0") + "f".repeat(56);
  return {
    kind: "mock",
    async payCreator() {
      return { txHash: fakeTx() };
    },
    async redeemTo() {
      return { txHash: fakeTx() };
    },
  };
}

export interface CircleWalletEnv {
  apiKey: string;
  entitySecret: string;
  treasuryWalletId: string;
}

/**
 * Real Arc Testnet payments via a Circle Developer-Controlled wallet: each reward /
 * redeem is a USDC `createTransaction` transfer. Reliable, fully custodied by Circle,
 * but one on-chain tx per payment (no batching). Requires `@circle-fin/developer-controlled-wallets`.
 */
export async function createWalletPaymentProvider(env: CircleWalletEnv): Promise<PaymentProvider> {
  // Variable specifier so `tsc` doesn't try to resolve the (optional) package at build time.
  const spec = "@circle-fin/developer-controlled-wallets";
  const sdk: any = await import(/* @vite-ignore */ spec);
  const client = sdk.initiateDeveloperControlledWalletsClient({
    apiKey: env.apiKey,
    entitySecret: env.entitySecret,
  });

  async function transfer(to: string, amountUsdc: number, memo?: string) {
    const res = await client.createTransaction({
      walletId: env.treasuryWalletId,
      blockchain: ARC_TESTNET.circleBlockchain,
      tokenAddress: ARC_TESTNET.usdcAddress,
      destinationAddress: to,
      amounts: [amountUsdc.toString()],
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      refId: memo?.slice(0, 50),
    });
    // createTransaction returns { id, state }; the tx hash lands after mining.
    // Poll getTransaction until a txHash appears (short loop; Arc confirms fast).
    const id: string = res.data!.id;
    for (let i = 0; i < 30; i++) {
      const tx = await client.getTransaction({ id });
      const hash: string | undefined = tx.data?.transaction?.txHash;
      if (hash) return { txHash: hash };
      if (tx.data?.transaction?.state === "FAILED") throw new Error(`transfer ${id} failed`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`transfer ${id} did not confirm in time`);
  }

  return {
    kind: "wallet",
    payCreator: (to, amount, memo) => transfer(to, amount, memo ?? "copayme reward"),
    redeemTo: (to, amount, memo) => transfer(to, amount, memo ?? "copayme redeem"),
  };
}

export interface X402Env {
  /** Local EOA key for the treasury (the x402-batching client signs with this). */
  treasuryPrivateKey: string;
}

/**
 * Gasless x402 / Nanopayment path via Circle Gateway batched settlement.
 * Requires `@circle-fin/x402-batching` and a treasury that has deposited USDC into
 * the Gateway Wallet (see scripts/setup-treasury.ts). Rewards net into each creator's
 * Gateway balance; creators withdraw independently whenever they like.
 *
 * NOTE: the exact settle/pay method names should be confirmed against the installed
 * SDK version (see developers.circle.com/gateway/nanopayments/references/sdk). The
 * structure below follows the "Use BatchFacilitatorClient directly" quickstart.
 */
export async function createX402PaymentProvider(env: X402Env): Promise<PaymentProvider> {
  const serverSpec = "@circle-fin/x402-batching/server";
  const clientSpec = "@circle-fin/x402-batching/client";
  const server: any = await import(/* @vite-ignore */ serverSpec);
  const clientSdk: any = await import(/* @vite-ignore */ clientSpec);

  const facilitator = new server.BatchFacilitatorClient();
  const scheme = new clientSdk.BatchEvmScheme(env.treasuryPrivateKey as `0x${string}`);

  async function pay(to: string, amountUsdc: number) {
    const requirements = {
      scheme: "exact",
      network: ARC_TESTNET.x402Network,
      asset: ARC_TESTNET.usdcAddress,
      // USDC has 6 decimals in x402 amount encoding.
      amount: Math.round(amountUsdc * 1e6).toString(),
      payTo: to,
      maxTimeoutSeconds: 345_600,
    };
    // Treasury (buyer) signs an EIP-3009 authorization crediting the creator's Gateway balance.
    const payload = await scheme.createPayment(requirements);
    const settlement = await facilitator.settle(payload, requirements);
    if (!settlement?.success) throw new Error("x402 settlement failed");
    return { txHash: settlement.txHash ?? settlement.transaction ?? "pending-batch" };
  }

  return {
    kind: "x402",
    payCreator: (to, amount) => pay(to, amount),
    // Redeem in the x402 model is the creator calling GatewayClient.withdraw() client-side
    // from the website with their connected wallet. The vault can also push a direct transfer
    // as a fallback; here we treat redeem as a vault-side settlement to the creator address.
    redeemTo: (to, amount) => pay(to, amount),
  };
}

/** Select a provider from the environment. Falls back to mock when creds are missing. */
export async function createPaymentProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PaymentProvider> {
  const choice = (env.PAYMENT_PROVIDER ?? "mock").toLowerCase();
  try {
    if (choice === "wallet") {
      if (env.CIRCLE_API_KEY && env.CIRCLE_ENTITY_SECRET && env.TREASURY_WALLET_ID) {
        return await createWalletPaymentProvider({
          apiKey: env.CIRCLE_API_KEY,
          entitySecret: env.CIRCLE_ENTITY_SECRET,
          treasuryWalletId: env.TREASURY_WALLET_ID,
        });
      }
      console.warn("[payments] PAYMENT_PROVIDER=wallet but CIRCLE_* env is incomplete; using mock.");
    } else if (choice === "x402") {
      if (env.TREASURY_PRIVATE_KEY) {
        return await createX402PaymentProvider({ treasuryPrivateKey: env.TREASURY_PRIVATE_KEY });
      }
      console.warn("[payments] PAYMENT_PROVIDER=x402 but TREASURY_PRIVATE_KEY is missing; using mock.");
    }
  } catch (err) {
    console.error(`[payments] failed to init '${choice}' provider, falling back to mock:`, err);
  }
  return createMockPaymentProvider();
}
