import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

// Only connection metadata is stored here; file bytes never reach D1.
export const rooms = sqliteTable("rooms", {
  code: text("code").primaryKey(),
  hostToken: text("host_token").notNull(),
  guestToken: text("guest_token"),
  hostName: text("host_name").notNull(),
  guestName: text("guest_name"),
  offer: text("offer"),
  answer: text("answer"),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("rooms_expiry_idx").on(table.expiresAt)]);

export const limits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("limits_expiry_idx").on(table.expiresAt)]);
