import { Router } from "express";
import axios from "axios";
import { getBlingAccountById, updateBlingToken } from "./db";

export function registerBlingCallbackRoute(app: Router) {
  app.get("/api/bling/callback", async (req, res) => {
    const { code, state, error } = req.query as Record<string, string>;

    if (error) {
      console.error("[BlingCallback] OAuth error:", error);
      return res.redirect(`/?bling_error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      return res.redirect("/?bling_error=missing_params");
    }

    let accountId: number;
    try {
      const decoded = JSON.parse(Buffer.from(state, "base64").toString("utf-8"));
      accountId = decoded.accountId;
    } catch {
      return res.redirect("/?bling_error=invalid_state");
    }

    const account = await getBlingAccountById(accountId);
    if (!account) {
      return res.redirect("/?bling_error=account_not_found");
    }

    try {
      const credentials = Buffer.from(`${account.clientId}:${account.clientSecret}`).toString("base64");
      const redirectUri = `${process.env.OAUTH_SERVER_URL ?? ""}/api/bling/callback`;

      const response = await axios.post(
        "https://api.bling.com.br/Api/v3/oauth/token",
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
        {
          headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "1.0",
          },
        }
      );

      const { access_token, refresh_token, expires_in } = response.data;
      const expiresAt = new Date(Date.now() + expires_in * 1000);
      await updateBlingToken(account.id, access_token, refresh_token, expiresAt);

      console.log(`[BlingCallback] Token salvo para conta ${account.id} (${account.name})`);
      return res.redirect("/?bling_success=1");
    } catch (err: any) {
      console.error("[BlingCallback] Erro ao trocar código por token:", err.message);
      return res.redirect(`/?bling_error=${encodeURIComponent(err.message)}`);
    }
  });
}
