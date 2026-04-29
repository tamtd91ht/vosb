import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

declare module "next-auth" {
  interface User {
    role: string;
    partnerId: number | null;
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  }
  interface Session {
    accessToken: string;
    user: {
      id: string;
      name: string;
      role: string;
      partnerId: number | null;
    };
    error?: string;
  }
}

// JWT types extended via callbacks using any casts below

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function refreshAccessToken(token: any) {
  try {
    const r = await fetch(
      `${
        process.env.API_BASE_INTERNAL ?? "http://localhost:8080"
      }/api/admin/auth/refresh`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: token.refreshToken }),
      }
    );
    if (!r.ok) return { ...token, error: "refresh_failed" };
    const data = await r.json();
    return {
      ...token,
      accessToken: data.token, // BE returns "token" not "access_token"
      expiresAt: Date.now() + data.expires_in * 1000,
      error: undefined,
    };
  } catch {
    return { ...token, error: "refresh_failed" };
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(creds) {
        if (!creds?.username || !creds?.password) return null;
        try {
          const r = await fetch(
            `${
              process.env.API_BASE_INTERNAL ?? "http://localhost:8080"
            }/api/admin/auth/login`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                username: creds.username,
                password: creds.password,
              }),
            }
          );
          if (!r.ok) return null;
          const data = await r.json();

          // Fetch user info
          const meR = await fetch(
            `${
              process.env.API_BASE_INTERNAL ?? "http://localhost:8080"
            }/api/admin/auth/me`,
            { headers: { Authorization: `Bearer ${data.token}` } }
          );
          const me = meR.ok
            ? await meR.json()
            : {
                id: 0,
                username: creds.username,
                role: "ADMIN",
                partner_id: null,
              };

          return {
            id: String(me.id),
            name: me.username,
            role: me.role,
            partnerId: me.partner_id ?? null,
            accessToken: data.token, // BE returns "token"
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + data.expires_in * 1000,
          };
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async jwt({ token, user }: { token: any; user: any }) {
      if (user) {
        token.role = user.role;
        token.partnerId = user.partnerId;
        token.accessToken = user.accessToken;
        token.refreshToken = user.refreshToken;
        token.expiresAt = user.expiresAt;
      }
      // Refresh if within 5 minutes of expiry
      if (Date.now() > token.expiresAt - 5 * 60 * 1000) {
        return refreshAccessToken(token);
      }
      return token;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async session({ session, token }: { session: any; token: any }) {
      session.accessToken = token.accessToken;
      session.error = token.error;
      if (session.user) {
        session.user.role = token.role;
        session.user.partnerId = token.partnerId;
      }
      return session;
    },
  },
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  trustHost: true,
});
