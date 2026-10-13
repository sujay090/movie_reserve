import type { Generated } from "kysely";

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED" | "DELETED";
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SessionsTable {
  id: string;
  user_id: string;
  expires_at: Date;
  created_at: Generated<Date>;
  last_seen_at: Generated<Date>;
}

export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
}
