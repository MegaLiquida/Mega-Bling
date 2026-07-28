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

  useEffect(() => {
    if (!open) return;
    setCnpjByAccount(
      Object.fromEntries(accounts.map((account) => [account.id, formatCnpj(account.cnpj ?? "")]))
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

                <div className="mt-4 border-t pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleReconnect(account.id)}
                    disabled={getAuthUrl.isPending}
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${isCurrentReconnect ? "animate-spin" : ""}`} />
                    {isCurrentReconnect ? "Abrindo Bling..." : "Reautorizar no Bling"}
                  </Button>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Use esta ação quando o refresh token expirar. Você será direcionado ao Bling para autorizar novamente o aplicativo.
                  </p>
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
