import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Migrations use the direct (unpooled) Neon connection.
    url: process.env.DATABASE_URL_UNPOOLED ?? "",
  },
});
