// SQL fragments for derived balances. Balances are ALWAYS computed from the
// ledger (opening value + posted entries); no editable balance is stored.
// These expressions mirror ACCOUNT_EFFECT / IOU_EFFECT in src/lib/txn-types.ts,
// and the integration tests check both against the same scenarios.
import { sql, type SQL } from "drizzle-orm";
import type { DB } from "../db/client";

export type Exec = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

/** Signed effect on the SOURCE account (account_id). */
export const SOURCE_DELTA = sql.raw(
  `CASE WHEN t.type IN ('income','borrow','repayment_received') THEN t.amount_paise ELSE -t.amount_paise END`,
);

/** Signed effect on a person's IOU (positive = they owe me more). */
export const IOU_DELTA = sql.raw(
  `CASE WHEN t.type IN ('lend','repayment_paid') THEN t.amount_paise
        WHEN t.type IN ('borrow','repayment_received') THEN -t.amount_paise ELSE 0 END`,
);

/** Per-account derived balance for an owner. Optionally only up to (and including) a date. */
export async function accountBalances(
  db: Exec,
  ownerId: string,
  opts: { accountId?: string } = {},
): Promise<Map<string, bigint>> {
  const filter: SQL = opts.accountId ? sql`AND a.id = ${opts.accountId}` : sql``;
  const res = await db.execute<{ id: string; balance: string }>(sql`
    SELECT a.id, (a.opening_balance_paise + COALESCE(m.delta, 0))::text AS balance
    FROM accounts a
    LEFT JOIN (
      SELECT id, SUM(delta) AS delta FROM (
        SELECT t.account_id AS id, ${SOURCE_DELTA} AS delta
          FROM transactions t WHERE t.owner_id = ${ownerId}
        UNION ALL
        SELECT t.to_account_id AS id, t.amount_paise AS delta
          FROM transactions t WHERE t.owner_id = ${ownerId} AND t.type = 'transfer'
      ) u GROUP BY id
    ) m ON m.id = a.id
    WHERE a.owner_id = ${ownerId} ${filter}`);
  return new Map(res.rows.map((r) => [r.id, BigInt(r.balance)]));
}

/** Per-person signed net IOU. Optionally excluding one transaction (for edits). */
export async function personNets(
  db: Exec,
  ownerId: string,
  opts: { personId?: string; excludeTxnId?: string } = {},
): Promise<Map<string, bigint>> {
  const pFilter: SQL = opts.personId ? sql`AND p.id = ${opts.personId}` : sql``;
  const tFilter: SQL = opts.excludeTxnId ? sql`AND t.id <> ${opts.excludeTxnId}` : sql``;
  const res = await db.execute<{ id: string; net: string }>(sql`
    SELECT p.id, (p.opening_iou_paise + COALESCE(SUM(${IOU_DELTA}), 0))::text AS net
    FROM people p
    LEFT JOIN transactions t ON t.owner_id = p.owner_id AND t.person_id = p.id ${tFilter}
    WHERE p.owner_id = ${ownerId} ${pFilter}
    GROUP BY p.id`);
  return new Map(res.rows.map((r) => [r.id, BigInt(r.net)]));
}

/** Headline IOU totals. Different people are NEVER netted against each other. */
export function iouTotals(nets: Iterable<bigint>): { owedToMe: bigint; iOwe: bigint } {
  let owedToMe = 0n;
  let iOwe = 0n;
  for (const n of nets) {
    if (n > 0n) owedToMe += n;
    else if (n < 0n) iOwe += -n;
  }
  return { owedToMe, iOwe };
}
