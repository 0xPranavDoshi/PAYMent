/**
 * Demo data for the daily revenue share (fake money only).
 *
 *   pnpm --filter @copayme/onchain seed:demo-tails                 # create demo followers + settled trades
 *   pnpm --filter @copayme/onchain seed:demo-tails -- --wipe       # delete demo followers (and their trades)
 *   pnpm --filter @copayme/onchain seed:demo-tails -- --reset-today  # undo today's payout run, to press the button again
 *
 * Creates demo follower accounts (x_user_id 'demo:payout_follower_N') that tailed the scored,
 * resolved picks of DEMO_CREATOR (default mugdhapatil17, opted in) and pickswise (not opted in,
 * so the treasury keeps its share). PnL uses each pick's real outcome and the trading formula.
 */
import postgres from "postgres";

const CREATOR = (process.env.DEMO_CREATOR ?? "mugdhapatil17").toLowerCase();
const OTHER = "pickswise";
const FOLLOWERS = 4;
const STAKE = 50;

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const sql = postgres(url, { ssl: /localhost/.test(url) ? false : "require", max: 1 });
const args = process.argv.slice(2);

async function wipe() {
  const del = await sql`delete from users where x_user_id like 'demo:payout_follower_%' returning x_handle`;
  console.log(`wiped ${del.length} demo followers (their trades and payout items cascade)`);
}

async function resetToday() {
  const today = new Date().toISOString().slice(0, 10);
  const [run] = await sql<{ id: string }[]>`select id from payout_runs where run_day = ${today}::date`;
  if (!run) return console.log(`no payout run today (${today})`);
  const led = await sql`delete from earnings_ledger where source_ref like ${`revshare:${run.id}:%`} returning amount_usdc`;
  await sql`delete from payout_runs where id = ${run.id}`; // items cascade
  console.log(`reset today's run ${run.id}: removed ${led.length} creator credits; its trades are unprocessed again`);
}

async function seed() {
  const followers: string[] = [];
  for (let i = 1; i <= FOLLOWERS; i++) {
    const [u] = await sql<{ id: string }[]>`
      insert into users (x_user_id, x_handle) values (${`demo:payout_follower_${i}`}, ${`demo_payout_follower_${i}`})
      on conflict (x_user_id) do update set x_handle = excluded.x_handle returning id`;
    followers.push(u!.id);
  }

  const picks = await sql<{ id: string; handle: string; odds: number; points: number }[]>`
    select c.id, lower(u.x_handle) handle, c.odds_at_call odds, c.points::float points
    from calls c join users u on u.id = c.user_id join markets m on m.id = c.market_id
    where c.status = 'scored' and m.status = 'resolved' and c.odds_at_call is not null
      and lower(u.x_handle) in (${CREATOR}, ${OTHER})`;

  let created = 0;
  for (const p of picks) {
    // The other creator gets fewer followers, just enough to show the treasury keeping a share.
    const who = p.handle === CREATOR ? followers : followers.slice(0, 1);
    for (const f of who) {
      const exit = p.points > 0 ? 1 : 0;
      const pnl = Math.round(((STAKE * (exit - p.odds)) / p.odds) * 100) / 100;
      const r = await sql`
        insert into tails (follower_id, call_id, mode, amount_usdc, entry_odds, status, pnl_usdc, source, exit_odds, settled_at)
        select ${f}, ${p.id}, 'paper', ${STAKE}, ${p.odds}, 'settled', ${pnl}, 'manual', ${exit}, now()
        where not exists (select 1 from tails where follower_id = ${f} and call_id = ${p.id})
        returning id`;
      created += r.length;
    }
  }
  console.log(`seeded ${created} settled demo trades from ${FOLLOWERS} followers on ${picks.length} picks (${CREATOR}, ${OTHER})`);
}

try {
  if (args.includes("--wipe")) await wipe();
  else if (args.includes("--reset-today")) await resetToday();
  else await seed();
} finally {
  await sql.end();
}
