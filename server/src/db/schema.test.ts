import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

function readMigrationSql(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql"));
  expect(files.length).toBeGreaterThan(0);
  return files.map((file) => readFileSync(join(MIGRATIONS_DIR, file), "utf8")).join("\n");
}

const FORBIDDEN_COLUMN_TYPES = [
  "real",
  "double precision",
  "float4",
  "float8",
  "numeric",
  "decimal",
  "money",
];

const SOFT_DELETABLE_FINANCIAL_TABLES = ["transactions", "receipts", "invoices"];

describe("schema migrations", () => {
  const sql = readMigrationSql();

  it("contains no floating-point or numeric/decimal/money column types", () => {
    const lowerSql = sql.toLowerCase();
    for (const forbidden of FORBIDDEN_COLUMN_TYPES) {
      expect(lowerSql, `found forbidden column type "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it.each(SOFT_DELETABLE_FINANCIAL_TABLES)(
    "has deleted_at on the %s table",
    (tableName) => {
      const tableMatch = sql.match(
        new RegExp(`CREATE TABLE IF NOT EXISTS "${tableName}" \\(([\\s\\S]*?)\\n\\);`),
      );
      expect(tableMatch, `could not find CREATE TABLE statement for "${tableName}"`).not.toBeNull();
      const tableBody = tableMatch![1];
      expect(tableBody).toMatch(/"deleted_at"\s+timestamp with time zone/);
    },
  );

  it("adds a nullable archived_at timestamp to accounts", () => {
    expect(sql).toMatch(
      /ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;/,
    );
  });

  describe("vat_return_drafts", () => {
    const tableBody = () => {
      const match = sql.match(/CREATE TABLE IF NOT EXISTS "vat_return_drafts" \(([\s\S]*?)\n\);/);
      expect(match, "could not find CREATE TABLE statement for vat_return_drafts").not.toBeNull();
      return match![1];
    };

    it("allows one draft per user and period", () => {
      expect(tableBody()).toContain('UNIQUE("user_id","period_key")');
    });

    it.each(["box1", "box2", "box3", "box4", "box5", "box6", "box7", "box8", "box9"])(
      "stores %s as integer pence",
      (box) => {
        expect(tableBody()).toMatch(new RegExp(`"${box}_pence" integer NOT NULL`));
      },
    );

    it("keeps only timestamps for the declaration, not its text", () => {
      const body = tableBody();
      expect(body).toMatch(/"declaration_accepted_at" timestamp with time zone/);
      expect(body).not.toMatch(/declaration_text/);
    });

    it("has no deleted_at, since drafts are never removed", () => {
      expect(tableBody()).not.toContain("deleted_at");
    });
  });

  describe("vat_submissions", () => {
    const tableBody = () => {
      const match = sql.match(/CREATE TABLE IF NOT EXISTS "vat_submissions" \(([\s\S]*?)\n\);/);
      expect(match, "could not find CREATE TABLE statement for vat_submissions").not.toBeNull();
      return match![1];
    };

    it("locks one submission per user, period and HMRC environment", () => {
      expect(tableBody()).toContain('UNIQUE("user_id","period_key","sandbox")');
    });

    it("defines the status enum values", () => {
      expect(sql).toMatch(
        /CREATE TYPE "public"\."vat_submission_status" AS ENUM\('pending', 'submitted', 'failed'\)/,
      );
    });

    it("stores only the receipt fields, never tokens or headers", () => {
      const body = tableBody();
      expect(body).toMatch(/"form_bundle_number" text/);
      expect(body).toMatch(/"processing_date" timestamp with time zone/);
      expect(body).not.toMatch(/token|authorization/i);
    });

    it("has no deleted_at, since failed attempts are flipped, never removed", () => {
      expect(tableBody()).not.toContain("deleted_at");
    });
  });

  it("indexes vat_return_drafts by (user_id, period_end) for the history list", () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS "vat_return_drafts_user_period_end_idx" ON "vat_return_drafts" \("user_id","period_end"\)/,
    );
  });

  it("indexes transactions by (user_id, date) for the entries list", () => {
    expect(readFileSync(new URL("./migrations/0007_entries_list_indexes.sql", import.meta.url), "utf8")).toMatch(
      /CREATE INDEX IF NOT EXISTS "transactions_user_date_idx" ON "transactions" \("user_id","date"\)/,
    );
  });

  it("indexes invoices by (user_id, created_at, id) and invoice_lines by invoice_id", () => {
    const sql = readFileSync(new URL("./migrations/0010_invoices_list_indexes.sql", import.meta.url), "utf8");
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS "invoices_user_created_idx" ON "invoices" \("user_id","created_at","id"\)/,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS "invoice_lines_invoice_id_idx" ON "invoice_lines" \("invoice_id"\)/,
    );
  });

  it("adds a nullable deleted_at to invoice_lines so edited draft lines are soft-deleted", () => {
    expect(sql).toMatch(
      /ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;/,
    );
  });

  it("creates login_attempts with only a timestamp and an attempted_at index", () => {
    const match = sql.match(/CREATE TABLE IF NOT EXISTS "login_attempts" \(([\s\S]*?)\n\);/);
    expect(match, "could not find CREATE TABLE statement for login_attempts").not.toBeNull();
    expect(match![1]).not.toMatch(/ip|password|user/i);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS "login_attempts_attempted_at_idx" ON "login_attempts" \("attempted_at"\)/,
    );
  });

  describe("mileage_trips", () => {
    const tableBody = () => {
      const match = sql.match(/CREATE TABLE IF NOT EXISTS "mileage_trips" \(([\s\S]*?)\n\);/);
      expect(match, "could not find CREATE TABLE statement for mileage_trips").not.toBeNull();
      return match![1];
    };

    it("is owned by a user and soft-deletable", () => {
      const body = tableBody();
      expect(body).toMatch(/"user_id" uuid NOT NULL/);
      expect(body).toMatch(/"deleted_at" timestamp with time zone/);
    });

    it("stores miles as a positive integer", () => {
      const body = tableBody();
      expect(body).toMatch(/"miles" integer NOT NULL/);
      expect(body).toContain('CHECK ("mileage_trips"."miles" > 0)');
    });

    it("limits the vehicle type to the enum values", () => {
      expect(sql).toMatch(
        /CREATE TYPE "public"\."mileage_vehicle_type" AS ENUM\('car_van', 'motorcycle', 'bicycle'\)/,
      );
      expect(tableBody()).toMatch(/"vehicle_type" "mileage_vehicle_type" NOT NULL/);
    });

    it("indexes trips by (user_id, date) for the list and the yearly claim", () => {
      expect(sql).toMatch(
        /CREATE INDEX IF NOT EXISTS "mileage_trips_user_date_idx" ON "mileage_trips" \("user_id","date"\)/,
      );
    });
  });

  it("keeps the migration journal a single linear chain", () => {
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
    ) as { entries: { idx: number; when: number; tag: string }[] };
    const whens = journal.entries.map((entry) => entry.when);
    expect(whens).toEqual([...whens].sort((a, b) => a - b));
    expect(new Set(journal.entries.map((entry) => entry.idx)).size).toBe(journal.entries.length);
  });

  describe("trading_allowance_choices", () => {
    const tableBody = () => {
      const match = sql.match(/CREATE TABLE IF NOT EXISTS "trading_allowance_choices" \(([\s\S]*?)\n\);/);
      expect(match, "could not find CREATE TABLE statement for trading_allowance_choices").not.toBeNull();
      return match![1];
    };

    it("locks one choice per user and tax year", () => {
      expect(tableBody()).toContain('UNIQUE("user_id","tax_year")');
    });

    it("limits the method to actual or allowance", () => {
      expect(sql).toMatch(/CREATE TYPE "public"\."trading_allowance_method" AS ENUM\('actual', 'allowance'\)/);
    });
  });
});
