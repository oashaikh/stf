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
});
