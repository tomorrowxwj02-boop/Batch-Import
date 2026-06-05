import { neon } from "@neondatabase/serverless";
import { ParseRule } from "@/lib/types";

let migrationPromise: Promise<void> | null = null;

type ParsedOrderKey = { type: "code"; externalCode: string } | { type: "row"; id: number };

type OrderHeaderInput = {
  externalCode: string;
  storeName: string;
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string;
};

type OrderItemInput = {
  skuCode: string;
  skuName: string;
  quantity: string;
  spec: string;
  remark: string;
};

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
  const orderKeys = new Set<string>();
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
      orderKeys.add(row.externalCode ? `code:${row.externalCode}` : `row:${index + 1}`);
    } catch (error) {
      failed.push({ index: index + 1, reason: error instanceof Error ? error.message : "未知数据库错误" });
    }
  }

  return { batchId, success, orderCount: orderKeys.size, failed };
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
    with all_rows as (
      select *,
             case
               when nullif(external_code, '') is null then 'row:' || id::text
               else 'code:' || external_code
             end as order_key
      from imported_orders
      where (${from}::text is null or created_at >= ${from}::timestamptz)
        and (${to}::text is null or created_at <= ${to}::timestamptz)
    ),
    matched_keys as (
      select distinct order_key
      from all_rows
      where ${q || null}::text is null
        or external_code ilike ${q ? `%${q}%` : null}
        or receiver_name ilike ${q ? `%${q}%` : null}
        or receiver_phone ilike ${q ? `%${q}%` : null}
        or receiver_address ilike ${q ? `%${q}%` : null}
        or store_name ilike ${q ? `%${q}%` : null}
        or sku_code ilike ${q ? `%${q}%` : null}
        or sku_name ilike ${q ? `%${q}%` : null}
    )
    select
      all_rows.order_key,
      max(all_rows.external_code) as external_code,
      max(all_rows.store_name) as store_name,
      max(all_rows.receiver_name) as receiver_name,
      max(all_rows.receiver_phone) as receiver_phone,
      max(all_rows.receiver_address) as receiver_address,
      count(*)::int as sku_count,
      coalesce(sum(all_rows.quantity), 0)::text as total_quantity,
      max(all_rows.source_file) as source_file,
      max(all_rows.batch_id) as batch_id,
      max(all_rows.created_at) as created_at
    from all_rows
    join matched_keys on matched_keys.order_key = all_rows.order_key
    group by all_rows.order_key
    order by max(all_rows.created_at) desc, max(all_rows.id) desc
    limit ${pageSize} offset ${offset}
  `;
  const countRows = await db`
    with all_rows as (
      select *,
             case
               when nullif(external_code, '') is null then 'row:' || id::text
               else 'code:' || external_code
             end as order_key
      from imported_orders
      where (${from}::text is null or created_at >= ${from}::timestamptz)
        and (${to}::text is null or created_at <= ${to}::timestamptz)
    )
    select count(distinct order_key)::int as total
    from all_rows
    where ${q || null}::text is null
      or external_code ilike ${q ? `%${q}%` : null}
      or receiver_name ilike ${q ? `%${q}%` : null}
      or receiver_phone ilike ${q ? `%${q}%` : null}
      or receiver_address ilike ${q ? `%${q}%` : null}
      or store_name ilike ${q ? `%${q}%` : null}
      or sku_code ilike ${q ? `%${q}%` : null}
      or sku_name ilike ${q ? `%${q}%` : null}
  `;
  return { rows, total: Number(countRows[0]?.total ?? 0), page, pageSize };
}

export async function getOrderGroup(orderKey: string) {
  await ensureSchema();
  const db = sql();
  const parsed = parseOrderKey(orderKey);

  const rows =
    parsed.type === "code"
      ? await db`
          select
            'code:' || max(external_code) as order_key,
            max(external_code) as external_code,
            max(store_name) as store_name,
            max(receiver_name) as receiver_name,
            max(receiver_phone) as receiver_phone,
            max(receiver_address) as receiver_address,
            count(*)::int as sku_count,
            coalesce(sum(quantity), 0)::text as total_quantity,
            max(source_file) as source_file,
            max(batch_id) as batch_id,
            max(created_at) as created_at
          from imported_orders
          where external_code = ${parsed.externalCode}
        `
      : await db`
          select
            'row:' || max(id)::text as order_key,
            max(external_code) as external_code,
            max(store_name) as store_name,
            max(receiver_name) as receiver_name,
            max(receiver_phone) as receiver_phone,
            max(receiver_address) as receiver_address,
            count(*)::int as sku_count,
            coalesce(sum(quantity), 0)::text as total_quantity,
            max(source_file) as source_file,
            max(batch_id) as batch_id,
            max(created_at) as created_at
          from imported_orders
          where id = ${parsed.id}
        `;

  const row = rows[0];
  if (!row?.order_key) throw new Error("运单不存在或已删除");
  return row;
}

export async function listOrderItems(input: {
  orderKey: string;
  q?: string;
  page?: number;
  pageSize?: number;
}) {
  await ensureSchema();
  const db = sql();
  const parsed = parseOrderKey(input.orderKey);
  const page = Math.max(input.page ?? 1, 1);
  const pageSize = Math.min(Math.max(input.pageSize ?? 8, 3), 50);
  const offset = (page - 1) * pageSize;
  const q = input.q?.trim();
  const like = q ? `%${q}%` : null;

  const rows =
    parsed.type === "code"
      ? await db`
          select id, sku_code, sku_name, quantity::text as quantity, spec, remark, created_at
          from imported_orders
          where external_code = ${parsed.externalCode}
            and (${q || null}::text is null
              or sku_code ilike ${like}
              or sku_name ilike ${like}
              or spec ilike ${like}
              or remark ilike ${like})
          order by id asc
          limit ${pageSize} offset ${offset}
        `
      : await db`
          select id, sku_code, sku_name, quantity::text as quantity, spec, remark, created_at
          from imported_orders
          where id = ${parsed.id}
            and (${q || null}::text is null
              or sku_code ilike ${like}
              or sku_name ilike ${like}
              or spec ilike ${like}
              or remark ilike ${like})
          order by id asc
          limit ${pageSize} offset ${offset}
        `;

  const countRows =
    parsed.type === "code"
      ? await db`
          select count(*)::int as total
          from imported_orders
          where external_code = ${parsed.externalCode}
            and (${q || null}::text is null
              or sku_code ilike ${like}
              or sku_name ilike ${like}
              or spec ilike ${like}
              or remark ilike ${like})
        `
      : await db`
          select count(*)::int as total
          from imported_orders
          where id = ${parsed.id}
            and (${q || null}::text is null
              or sku_code ilike ${like}
              or sku_name ilike ${like}
              or spec ilike ${like}
              or remark ilike ${like})
        `;

  return { items: rows, total: Number(countRows[0]?.total ?? 0), page, pageSize };
}

export async function updateOrderGroupHeader(orderKey: string, input: OrderHeaderInput) {
  await ensureSchema();
  const db = sql();
  const parsed = parseOrderKey(orderKey);
  const externalCode = cleanNullable(input.externalCode);
  const storeName = cleanNullable(input.storeName);
  const receiverName = cleanNullable(input.receiverName);
  const receiverPhone = cleanNullable(input.receiverPhone);
  const receiverAddress = cleanNullable(input.receiverAddress);
  const current = await getOrderGroup(orderKey);

  if (!externalCode && Number(current.sku_count) > 1) {
    throw new Error("多 SKU 运单必须保留外部编码，避免明细被拆散");
  }

  if (externalCode) {
    const conflicts =
      parsed.type === "code"
        ? await db`
            select id
            from imported_orders
            where external_code = ${externalCode}
              and external_code <> ${parsed.externalCode}
            limit 1
          `
        : await db`
            select id
            from imported_orders
            where external_code = ${externalCode}
              and id <> ${parsed.id}
            limit 1
          `;
    if (conflicts.length) throw new Error("外部编码已被其他运单使用");
  }

  const updated =
    parsed.type === "code"
      ? await db`
          update imported_orders
          set external_code = ${externalCode},
              store_name = ${storeName},
              receiver_name = ${receiverName},
              receiver_phone = ${receiverPhone},
              receiver_address = ${receiverAddress}
          where external_code = ${parsed.externalCode}
          returning id
        `
      : await db`
          update imported_orders
          set external_code = ${externalCode},
              store_name = ${storeName},
              receiver_name = ${receiverName},
              receiver_phone = ${receiverPhone},
              receiver_address = ${receiverAddress}
          where id = ${parsed.id}
          returning id
        `;

  if (!updated.length) throw new Error("运单不存在或已删除");
  const newOrderKey = externalCode ? `code:${externalCode}` : `row:${updated[0].id}`;
  return getOrderGroup(newOrderKey);
}

export async function createOrderItem(orderKey: string, input: OrderItemInput) {
  await ensureSchema();
  const db = sql();
  const order = await getOrderGroup(orderKey);
  if (!order.external_code) {
    throw new Error("请先为运单填写外部编码，再新增多 SKU 明细");
  }
  const item = normalizeItemInput(input);
  const rows = await db`
    insert into imported_orders (
      external_code, store_name, receiver_name, receiver_phone, receiver_address,
      sku_code, sku_name, quantity, spec, remark, source_file, batch_id
    )
    values (
      ${order.external_code}, ${order.store_name}, ${order.receiver_name},
      ${order.receiver_phone}, ${order.receiver_address}, ${item.skuCode},
      ${item.skuName}, ${item.quantity}, ${item.spec}, ${item.remark},
      ${order.source_file}, ${order.batch_id}
    )
    returning id, sku_code, sku_name, quantity::text as quantity, spec, remark, created_at
  `;
  return rows[0];
}

export async function updateOrderItem(id: number, input: OrderItemInput) {
  await ensureSchema();
  const db = sql();
  const item = normalizeItemInput(input);
  const rows = await db`
    update imported_orders
    set sku_code = ${item.skuCode},
        sku_name = ${item.skuName},
        quantity = ${item.quantity},
        spec = ${item.spec},
        remark = ${item.remark}
    where id = ${id}
    returning id, sku_code, sku_name, quantity::text as quantity, spec, remark, created_at
  `;
  if (!rows[0]) throw new Error("SKU 明细不存在或已删除");
  return rows[0];
}

export async function deleteOrderItem(id: number) {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    delete from imported_orders
    where id = ${id}
    returning id
  `;
  return { deleted: rows.length };
}

export async function deleteOrderGroup(orderKey: string) {
  await ensureSchema();
  const db = sql();
  const parsed = parseOrderKey(orderKey);
  if (parsed.type === "code") {
    const rows = await db`
      delete from imported_orders
      where external_code = ${parsed.externalCode}
      returning id
    `;
    return { deleted: rows.length };
  }

  const rows = await db`
    delete from imported_orders
    where id = ${parsed.id}
    returning id
  `;
  return { deleted: rows.length };
}

function parseOrderKey(orderKey: string): ParsedOrderKey {
  if (orderKey.startsWith("code:")) {
    const externalCode = orderKey.slice("code:".length).trim();
    if (!externalCode) throw new Error("无效的运单标识");
    return { type: "code", externalCode };
  }

  if (orderKey.startsWith("row:")) {
    const id = Number(orderKey.slice("row:".length));
    if (!Number.isInteger(id) || id <= 0) throw new Error("无效的运单标识");
    return { type: "row", id };
  }

  throw new Error("无效的运单标识");
}

function cleanNullable(value: string) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeItemInput(input: OrderItemInput) {
  const skuCode = String(input.skuCode ?? "").trim();
  const skuName = String(input.skuName ?? "").trim();
  const quantity = Number(String(input.quantity ?? "").replace(/,/g, ""));
  if (!skuCode) throw new Error("SKU 编码不能为空");
  if (!skuName) throw new Error("SKU 名称不能为空");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("发货数量必须为正数");
  return {
    skuCode,
    skuName,
    quantity,
    spec: cleanNullable(input.spec),
    remark: cleanNullable(input.remark)
  };
}
