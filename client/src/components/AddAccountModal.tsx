import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AddAccountModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddAccountModal({ open, onClose, onSuccess }: AddAccountModalProps) {
  const [form, setForm] = useState({
    name: "",
    cnpj: "",
    clientId: "",
    clientSecret: "",
    accessToken: "",
    refreshToken: "",
  });

  const addAccount = trpc.bling.addAccount.useMutation({
    onSuccess: () => {
      toast.success("Conta adicionada com sucesso!");
      setForm({ name: "", cnpj: "", clientId: "", clientSecret: "", accessToken: "", refreshToken: "" });
      onSuccess();
      onClose();
    },
    onError: (err) => {
      toast.error(`Erro ao adicionar conta: ${err.message}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.clientId || !form.clientSecret) {
      toast.error("Preencha os campos obrigatórios: Nome, Client ID e Client Secret.");
      return;
    }
    addAccount.mutate({
      name: form.name,
      cnpj: form.cnpj || undefined,
      clientId: form.clientId,
      clientSecret: form.clientSecret,
      accessToken: form.accessToken || undefined,
      refreshToken: form.refreshToken || undefined,
    });
  };

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar Conta Bling</DialogTitle>
          <DialogDescription>
            Insira as credenciais da API Bling para conectar uma nova conta.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="name">
              Nome da Conta <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              placeholder="Ex: Loja Principal"
              value={form.name}
              onChange={set("name")}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="cnpj">CNPJ</Label>
            <Input
              id="cnpj"
              placeholder="00.000.000/0000-00"
              value={form.cnpj}
              onChange={set("cnpj")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="clientId">
              Client ID <span className="text-destructive">*</span>
            </Label>
            <Input
              id="clientId"
              placeholder="Client ID da API Bling"
              value={form.clientId}
              onChange={set("clientId")}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="clientSecret">
              Client Secret <span className="text-destructive">*</span>
            </Label>
            <Input
              id="clientSecret"
              type="password"
              placeholder="Client Secret da API Bling"
              value={form.clientSecret}
              onChange={set("clientSecret")}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="accessToken">Access Token</Label>
            <Input
              id="accessToken"
              placeholder="Token de acesso atual"
              value={form.accessToken}
              onChange={set("accessToken")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="refreshToken">Refresh Token</Label>
            <Input
              id="refreshToken"
              placeholder="Token de renovação"
              value={form.refreshToken}
              onChange={set("refreshToken")}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={addAccount.isPending}>
              {addAccount.isPending ? "Salvando..." : "Salvar Conta"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
