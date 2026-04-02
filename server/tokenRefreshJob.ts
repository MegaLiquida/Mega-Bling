/**
 * Token Refresh Job
 *
 * Roda em segundo plano e renova automaticamente os tokens das contas Bling
 * antes que expirem. O Bling emite tokens com validade de 6 horas (21600s).
 *
 * Estratégia:
 *  - Intervalo de verificação: a cada 30 minutos
 *  - Renova tokens que expiram em menos de 60 minutos (buffer generoso)
 *  - Em caso de falha, tenta novamente na próxima rodada (não bloqueia o servidor)
 */

import { getAllBlingAccounts } from "./db";
import { refreshBlingToken } from "./blingService";

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutos
const REFRESH_BUFFER_MS = 60 * 60 * 1000; // renovar se expira em menos de 60 min

async function refreshExpiringTokens() {
  let accounts: Awaited<ReturnType<typeof getAllBlingAccounts>>;
  try {
    accounts = await getAllBlingAccounts();
  } catch (err: any) {
    console.warn("[TokenRefreshJob] Não foi possível buscar contas:", err.message);
    return;
  }

  if (!accounts || accounts.length === 0) {
    console.log("[TokenRefreshJob] Nenhuma conta Bling cadastrada.");
    return;
  }

  const now = Date.now();
  let renewed = 0;
  let skipped = 0;
  let failed = 0;

  for (const account of accounts) {
    // Pular contas sem refresh token (não é possível renovar)
    if (!account.refreshToken) {
      skipped++;
      continue;
    }

    const expiresAt = account.tokenExpiresAt ? new Date(account.tokenExpiresAt).getTime() : 0;
    const timeUntilExpiry = expiresAt - now;

    // Renovar se: sem data de expiração, já expirado, ou expira em menos de 60 min
    if (!expiresAt || timeUntilExpiry < REFRESH_BUFFER_MS) {
      const minutesLeft = Math.round(timeUntilExpiry / 60000);
      console.log(
        `[TokenRefreshJob] Renovando token da conta "${account.name}" (ID: ${account.id}) — expira em ${minutesLeft} min`
      );
      try {
        await refreshBlingToken(account);
        console.log(`[TokenRefreshJob] ✓ Token renovado com sucesso para "${account.name}"`);
        renewed++;
      } catch (err: any) {
        console.error(
          `[TokenRefreshJob] ✗ Falha ao renovar token de "${account.name}": ${err.message}`
        );
        failed++;
      }
      // Pequeno delay entre renovações para não sobrecarregar a API Bling
      await new Promise((r) => setTimeout(r, 500));
    } else {
      const minutesLeft = Math.round(timeUntilExpiry / 60000);
      console.log(
        `[TokenRefreshJob] Token de "${account.name}" ainda válido por ${minutesLeft} min — sem renovação necessária`
      );
      skipped++;
    }
  }

  console.log(
    `[TokenRefreshJob] Ciclo concluído: ${renewed} renovado(s), ${skipped} ignorado(s), ${failed} falha(s)`
  );
}

export function startTokenRefreshJob() {
  console.log(
    `[TokenRefreshJob] Iniciado — verificação a cada ${CHECK_INTERVAL_MS / 60000} minutos`
  );

  // Executar imediatamente ao iniciar o servidor
  refreshExpiringTokens().catch((err) =>
    console.error("[TokenRefreshJob] Erro na execução inicial:", err.message)
  );

  // Agendar execuções periódicas
  const timer = setInterval(() => {
    refreshExpiringTokens().catch((err) =>
      console.error("[TokenRefreshJob] Erro no ciclo periódico:", err.message)
    );
  }, CHECK_INTERVAL_MS);

  // Garantir que o timer não impeça o processo de encerrar normalmente
  if (timer.unref) timer.unref();

  return timer;
}
