import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS === "true" ? "/green-tamil-nadu-dashboard/" : "/",
  publicDir: false,
  plugins: [react()],
  server: {
    proxy: {
      "/api": process.env.API_PROXY_TARGET || "http://localhost:3001",
    },
  },
});
