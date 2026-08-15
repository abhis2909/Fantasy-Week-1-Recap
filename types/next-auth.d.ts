import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "COMMISSIONER" | "MEMBER";
    } & DefaultSession["user"];
  }
  interface User {
    role?: "COMMISSIONER" | "MEMBER";
  }
}
