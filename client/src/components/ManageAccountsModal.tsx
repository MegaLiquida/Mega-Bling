import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, RefreshCw, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCnpj, isValidCnpj, normalizeCnpj } from "@shared/cnpj";

interface ManagedAccount {
  id: number;
  name: string;
  cnpj: string | null;
  hasToken: boolean;
  tokenExpiresAt: Date | string | null;
}

interface ManageAccountsModalProps {
  open: boolean;
  onClose: () => void;
  accounts: ManagedAccount[];
  onSuccess: () => void;
}

export function ManageAccountsModal({
  open,
  onClose,
  accounts,
  onSuccess,
}: ManageAccountsModalProps) {
  const [cnpjByAccount, setCnpjByAccount] = useState<Record<number, string>>({});
  const [credentialsByAccount, setCredentialsByAccount] = useState<
    Record<number, { clientId: string; clientSecret: string; accessToken: string; refreshToken: string }>
  >({});

  useEffect(() => {
    if (!open) return;
    setCnpjByAccount(
      Object.fromEntries(accounts.map((account) => [account.id, formatCnpj(account.cnpj ?? "")]))
    );
    setCredentialsByAccount(
      Object.fromEntries(
        accounts.map((account) => [
          account.id,
          { clientId: "", clientSecret: "", accessToken: "", refreshToken: "" },
        ])
      )
    );
  }, [open, accounts]);

  const updateCnpj = trpc.bling.updateAccountCnpj.useMutation({
    onSuccess: (_data, variables) => {
      toast.success("CNPJ atualizado com sucesso.");
      setCnpjByAccount((current) => ({
        ...current,
        [variables.accountId]: formatCnpj(variables.cnpj),
      }));
      onSuccess();
    },
    onError: (error) => {
      toast.error(`Não foi possível atualizar o CNPJ: ${error.message}`);
    },
  });

  const getAuthUrl = trpc.bling.getAuthUrl.useMutation({
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
    onError: (error) => {
      toast.error(`Não foi possível iniciar a reautorização: ${error.message}`);
    },
  });

  const updateCredentials = trpc.bling.updateAccountCredentials.useMutation({
    onSuccess: (_data, variables) => {
      toast.success("Credenciais e tokens atualizados com sucesso.");
      setCredentialsByAccount((current) => ({
        ...current,
        [variables.accountId]: { clientId: "", clientSecret: "", accessToken: "", refreshToken: "" },
      }));
      onSuccess();
    },
    onError: (error) => {
      toast.error(`Não foi possível atualizar as credenciais: ${error.message}`);
    },
  });

  function handleCnpjChange(accountId: number, value: string) {
    setCnpjByAccount((current) => ({
      ...current,
      [accountId]: formatCnpj(value),
    }));
  }

  function handleSaveCnpj(accountId: number) {
    const cnpj = normalizeCnpj(cnpjByAccount[accountId] ?? "");
    if (!isValidCnpj(cnpj)) {
      toast.error("Informe um CNPJ válido com 14 dígitos.");
      return;
    }
    updateCnpj.mutate({ accountId, cnpj });
  }

  function handleReconnect(accountId: number) {
    getAuthUrl.mutate({ accountId });
  }

  function handleCredentialChange(
    accountId: number,
    field: "clientId" | "clientSecret" | "accessToken" | "refreshToken",
    value: string
  ) {
    setCredentialsByAccount((current) => {
      const previous = current[accountId] ?? {
        clientId: "",
        clientSecret: "",
        accessToken: "",
        refreshToken: "",
      };
      return {
        ...current,
        [accountId]: { ...previous, [field]: value },
      };
    });
  }

  function handleSaveCredentials(accountId: number) {
    const credentials = credentialsByAccount[accountId];
    if (!credentials?.clientId || !credentials.clientSecret || !credentials.accessToken || !credentials.refreshToken) {
      toast.error("Informe Client ID, Client Secret, Access Token e Refresh Token.");
      return;
    }

    updateCredentials.mutate({
      accountId,
      clientId: credentials.clientId.trim(),
      clientSecret: credentials.clientSecret.trim(),
      accessToken: credentials.accessToken.trim(),
      refreshToken: credentials.refreshToken.trim(),
      expiresIn: 21600,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Gerenciar contas Bling</DialogTitle>
          <DialogDescription>
            Atualize o CNPJ de cada empresa ou reautorize uma instalação cujo token expirou.
            A reautorização atualiza a conta existente e não cria uma duplicata.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {accounts.map((account) => {
            const value = cnpjByAccount[account.id] ?? "";
            const normalizedValue = normalizeCnpj(value);
            const normalizedSaved = normalizeCnpj(account.cnpj ?? "");
            const isChanged = normalizedValue !== normalizedSaved;
            const isCurrentUpdate =
              updateCnpj.isPending && updateCnpj.variables?.accountId === account.id;
            const isCurrentReconnect =
              getAuthUrl.isPending && getAuthUrl.variables?.accountId === account.id;

            return (
              <section key={account.id} className="rounded-lg border p-4">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-medium">{account.name}</h3>
                    <p className="text-xs text-muted-foreground">Conta #{account.id}</p>
                  </div>
                  {account.hasToken ? (
                    <Badge variant="outline" className="gap-1 text-green-700">
                      <CheckCircle2 className="h-3 w-3" />
                      Token cadastrado
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 text-amber-700">
                      <AlertTriangle className="h-3 w-3" />
                      Sem token
                    </Badge>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <div className="grid gap-2">
                    <Label htmlFor={`cnpj-${account.id}`}>CNPJ da empresa</Label>
                    <Input
                      id={`cnpj-${account.id}`}
                      inputMode="numeric"
                      maxLength={18}
                      placeholder="00.000.000/0000-00"
                      value={value}
                      onChange={(event) => handleCnpjChange(account.id, event.target.value)}
                    />
                    {!account.cnpj && (
                      <p className="text-xs text-amber-700">
                        CNPJ não configurado. A conta não pode ser usada como destinatária de NFe.
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => handleSaveCnpj(account.id)}
                    disabled={!isChanged || isCurrentUpdate || !isValidCnpj(normalizedValue)}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {isCurrentUpdate ? "Salvando..." : "Salvar CNPJ"}
                  </Button>
                </div>

                <div className="mt-4 border-t pt-4 space-y-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleReconnect(account.id)}
                    disabled={getAuthUrl.isPending}
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${isCurrentReconnect ? "animate-spin" : ""}`} />
                    {isCurrentReconnect ? "Abrindo Bling..." : "Reautorizar no Bling"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Use esta ação quando o refresh token expirar. Você será direcionado ao Bling para autorizar novamente o aplicativo.
                  </p>

                  <div className="rounded-md border bg-muted/20 p-3 space-y-3">
                    <div>
                      <h4 className="text-sm font-medium">Atualizar credenciais manualmente</h4>
                      <p className="text-xs text-muted-foreground">
                        Use quando você já recebeu um novo par de tokens. Os campos ficam vazios por segurança e são limpos após salvar.
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <Label htmlFor={`client-id-${account.id}`}>Client ID</Label>
                        <Input
                          id={`client-id-${account.id}`}
                          autoComplete="off"
                          value={credentialsByAccount[account.id]?.clientId ?? ""}
                          onChange={(event) => handleCredentialChange(account.id, "clientId", event.target.value)}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor={`client-secret-${account.id}`}>Client Secret</Label>
                        <Input
                          id={`client-secret-${account.id}`}
                          type="password"
                          autoComplete="new-password"
                          value={credentialsByAccount[account.id]?.clientSecret ?? ""}
                          onChange={(event) => handleCredentialChange(account.id, "clientSecret", event.target.value)}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor={`access-token-${account.id}`}>Access Token</Label>
                        <Input
                          id={`access-token-${account.id}`}
                          type="password"
                          autoComplete="off"
                          value={credentialsByAccount[account.id]?.accessToken ?? ""}
                          onChange={(event) => handleCredentialChange(account.id, "accessToken", event.target.value)}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor={`refresh-token-${account.id}`}>Refresh Token</Label>
                        <Input
                          id={`refresh-token-${account.id}`}
                          type="password"
                          autoComplete="off"
                          value={credentialsByAccount[account.id]?.refreshToken ?? ""}
                          onChange={(event) => handleCredentialChange(account.id, "refreshToken", event.target.value)}
                        />
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => handleSaveCredentials(account.id)}
                      disabled={updateCredentials.isPending}
                    >
                      <Save className="mr-2 h-4 w-4" />
                      {updateCredentials.isPending && updateCredentials.variables?.accountId === account.id
                        ? "Atualizando..."
                        : "Salvar credenciais"}
                    </Button>
                  </div>
                </div>
              </section>
            );
          })}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
