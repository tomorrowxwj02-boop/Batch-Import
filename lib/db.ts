import { neon } from "@neondatabase/serverless";
import { ParseRule } from "@/lib/types";

let migrationPromise: Promise<void> | null = null;

function sql() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("缺少 DATABASE_URL / POSTGRES_URL 环境变量");
  return neon(url);
}

export async function ensureSchema() {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      const db = sql();
      await db`
        create table if not exists parse_rules (
          id bigserial primary key,
          name text not null,
          description text,
          rule jsonb not null,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `;
      await db`
        create table if not exists imported_orders (
          id bigserial primary key,
          external_code text,
          store_name text,
          receiver_name text,
          receiver_phone text,
          receiver_address text,
          sku_code text not null,
          sku_name text not null,
          quantity numeric not null,
          spec text,
          remark text,
          source_file text,
          batch_id text not null,
          created_at timestamptz not null default now()
        )
      `;
      await db`create index if not exists imported_orders_external_code_idx on imported_orders (external_code)`;
      await db`create index if not exists imported_orders_receiver_name_idx on imported_orders (receiver_name)`;
      await db`create index if not exists imported_orders_created_at_idx on imported_orders (created_at desc)`;
    })();
  }
  return migrationPromise;
}

export async function listRules() {
  await ensureSchema();
  const db = sql();
  return db`
    select id, name, description, rule, created_at, updated_at
    from parse_rules
    order by updated_at desc, id desc
  `;
}

export async function createRule(rule: ParseRule, description?: string) {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    insert into parse_rules (name, description, rule)
    values (${rule.name}, ${description ?? rule.description ?? null}, ${JSON.stringify(rule)}::jsonb)
    returning id, name, description, rule, created_at, updated_at
  `;
  return rows[0];
}

export async function updateRule(id: number, rule: ParseRule, description?: string) {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    update parse_rules
    set name = ${rule.name},
        description = ${description ?? rule.description ?? null},
        rule = ${JSON.stringify(rule)}::jsonb,
        updated_at = now()
    where id = ${id}
    returning id, name, description, rule, created_at, updated_at
  `;
  return rows[0];
}

export async function deleteRule(id: number) {
  await ensureSchema();
  const db = sql();
  await db`delete from parse_rules where id = ${id}`;
}

export async function findExistingExternalCodes(codes: string[]) {
  await ensureSchema();
  const cleaned = Array.from(new Set(codes.map((code) => code.trim()).filter(Boolean)));
  if (!cleaned.length) return [];
  const db = sql();
  const rows = await db`
    select distinct external_code
    from imported_orders
    where external_code = any(${cleaned})
  `;
  return rows.map((row) => String(row.external_code));
}

export async function insertOrders(input: {
  rows: Array<{
    externalCode: string;
    storeName: string;
    receiverName: string;
    receiverPhone: string;
    receiverAddress: string;
    skuCode: string;
    skuName: string;
    quantity: string;
    spec: string;
    remark: string;
  }>;
  sourceFile?: string;
}) {
  await ensureSchema();
  const db = sql();
  const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let success = 0;
  const failed: Array<{ index: number; reason: string }> = [];

  for (let index = 0; index < input.rows.length; index += 1) {
    const row = input.rows[index];
    const quantity = Number(String(row.quantity).replace(/,/g, ""));
    try {
      await db`
        insert into imported_orders (
          external_code, store_name, receiver_name, receiver_phone, receiver_address,
          sku_code, sku_name, quantity, spec, remark, source_file, batch_id
        )
        values (
          ${row.externalCode || null}, ${row.storeName || null}, ${row.receiverName || null},
          ${row.receiverPhone || null}, ${row.receiverAddress || null}, ${row.skuCode},
          ${row.skuName}, ${quantity}, ${row.spec || null}, ${row.remark || null},
          ${input.sourceFile || null}, ${batchId}
        )
      `;
      success += 1;
    } catch (error) {
      failed.push({ index: index + 1, reason: error instanceof Error ? error.message : "未知数据库错误" });
    }
  }

  return { batchId, success, failed };
}

export async function listOrders(input: {
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}) {
  await ensureSchema();
  const db = sql();
  const page = Math.max(input.page ?? 1, 1);
  const pageSize = Math.min(Math.max(input.pageSize ?? 20, 5), 100);
  const offset = (page - 1) * pageSize;
  const q = input.q?.trim();
  const from = input.dateFrom || null;
  const to = input.dateTo || null;

  const rows = await db`
    select id, external_code, store_name, receiver_name, receiver_phone, receiver_address,
           sku_code, sku_name, quantity::text, spec, remark, source_file, batch_id, created_at
    from imported_orders
    where (${q || null}::text is null
      or external_code ilike ${q ? `%${q}%` : null}
      or receiver_name ilike ${q ? `%${q}%` : null}
      or store_name ilike ${q ? `%${q}%` : null})
      and (${from}::text is null or created_at >= ${from}::timestamptz)
      and (${to}::text is null or created_at <= ${to}::timestamptz)
    order by created_at desc, id desc
    limit ${pageSize} offset ${offset}
  `;
  const countRows = await db`
    select count(*)::int as total
    from imported_orders
    where (${q || null}::text is null
      or external_code ilike ${q ? `%${q}%` : null}
      or receiver_name ilike ${q ? `%${q}%` : null}
      or store_name ilike ${q ? `%${q}%` : null})
      and (${from}::text is null or created_at >= ${from}::timestamptz)
      and (${to}::text is null or created_at <= ${to}::timestamptz)
  `;
  return { rows, total: Number(countRows[0]?.total ?? 0), page, pageSize };
}
