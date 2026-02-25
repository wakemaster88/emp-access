import "next-auth";

declare module "next-auth" {
  interface User {
    role?: string;
    accountId?: number | null;
    accountName?: string | null;
  }

  interface Session {
    user: User & {
      id: string;
      role: string;
      accountId: number | null;
      accountName: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    accountId?: number | null;
    accountName?: string | null;
  }
}
