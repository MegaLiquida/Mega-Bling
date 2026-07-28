import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { ProductTable, ProductItem } from "@/components/ProductTable";
import { AddAccountModal } from "@/components/AddAccountModal";
import { ManageAccountsModal } from "@/components/ManageAccountsModal";
import { Package, Send, History, RefreshCw, CheckCircle2, AlertTriangle, Clock, Plus, Search, Loader2, XCircle, ShieldAlert, ShieldCheck, Timer, Settings } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Step = 1 | 2 | 3;

type ProductCheckStatus = "pending" | "checking" | "found" | "created" | "error";

interface ProductCheckResult {
  sku: string;
  name: string;
  status: ProductCheckStatus;
  error?: string;
}

export default function Home() {
  // Auth removido — sistema acessível sem login
  const [step, setStep] = useState<Step>(1);
  const [sourceType, setSourceType] = useState<"bling" | "magis5">("bling");
  const [sourceAccountId, setSourceAccountId] = useState<string>("");
  const [destAccountId, setDestAccountId] = useState<string>("");
  const [syncDate, setSyncDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [orderCount, setOrderCount] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [manageAccountsOpen, setManageAccountsOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [productChecks, setProductChecks] = useState<ProductCheckResult[]>([]);
  const [checksDone, setChecksDone] = useState(false);

  const utils = trpc.useUtils();
  const { data: accounts = [] } = trpc.bling.listAccounts.useQuery(undefined);
  const { data: history = [] } = trpc.bling.getSyncHistory.useQuery(undefined);
  const { data: accountsStatus = [], refetch: refetchStatus } = trpc.bling.getAccountsStatus.useQuery(undefined, {
    refetchInterval: 10000, // Atualizar a cada 10 segundos para manter o contador
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthSuccess = params.get("bling_success");
    const oauthError = params.get("bling_error");

    if (oauthSuccess === "1") {
      toast.success("Conta Bling reautorizada com sucesso.");
      utils.bling.listAccounts.invalidate();
      utils.bling.getAccountsStatus.invalidate();
    } else if (oauthError) {
      toast.error(`Falha na reautorização do Bling: ${oauthError}`);
    }

    if (oauthSuccess || oauthError) {
      params.delete("bling_success");
      params.delete("bling_error");
      const query = params.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
      );
    }
  }, []);

  // Contador regressivo: atualiza a cada segundo para mostrar tempo restante
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const hasBlocked = accountsStatus.some((a: { blocked: boolean }) => a.blocked);
    if (!hasBlocked) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [accountsStatus]);

  // Helper: formata ms restantes como MM:SS ou HH:MM:SS
  function formatCountdown(ms: number | null): string {
    if (!ms || ms <= 0) return "00:00";
    const totalSec = Math.ceil(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  const fetchBlingProducts = trpc.bling.fetchOrderProducts.useMutation({
    onSuccess: (data) => {
      setProducts((data.products as ProductItem[]).map((p) => ({
        ...p,
        unit: (p.unit || "UN").trim() || "UN",
      })));
      setOrderCount(data.orderCount);
      if (data.products.length === 0) {
        toast.info("Nenhum produto encontrado para a data selecionada.");
      } else {
        setStep(2);
      }
    },
    onError: (err) => {
      if (err.message.includes("CLOUDFLARE_BLOCKED")) {
        setCloudflareBlocked(true);
      } else {
        toast.error(`Erro ao buscar produtos: ${err.message}`);
      }
    },
  });

  const fetchMagis5Products = trpc.bling.fetchMagis5Products.useMutation({
    onSuccess: (data) => {
      // Produtos do Magis5 não têm productId — usar 0 como placeholder
      setProducts((data.products as any[]).map((p: any) => ({
        productId: 0,
        sku: p.sku,
        name: p.name,
        quantity: p.quantity,
        price: p.price,
        unit: (p.unit || "UN").trim() || "UN",
        ncm: p.ncm,
        origem: p.origem,
        cest: p.cest,
      })));
      setOrderCount(data.orderCount);
      if (data.products.length === 0) {
        toast.info("Nenhum produto encontrado para a data selecionada.");
      } else {
        setStep(2);
      }
    },
    onError: (err) => {
      toast.error(`Erro ao buscar produtos: ${err.message}`);
    },
  });

  const saveNcmCache = trpc.bling.saveNcmCache.useMutation();

  const sendNFe = trpc.bling.sendSaleNFe.useMutation({
    onSuccess: (data) => {
      setProgress(100);
      toast.success(`Nota fiscal ${data.nfeNumber ?? ""} criada com sucesso! Total: R$ ${data.totalValue}`);
      setStep(1);
      setProducts([]);
      setOrderCount(0);
      setProgress(0);
      utils.bling.getSyncHistory.invalidate();
    },
    onError: (err) => {
      setProgress(0);
      const msg = err.message;
      if (msg.includes("NCM")) {
        toast.error(msg, { duration: 15000 });
      } else {
        toast.error(`Erro ao criar nota: ${msg}`, { duration: 8000 });
      }
    },
  });

  function handleUpdateNcm(sku: string, ncm: string, persist = false) {
    setProducts((prev) => prev.map((p) => (p.sku === sku ? { ...p, ncm } : p)));
    // Persistir no banco quando o usuário sair do campo (onBlur) e o NCM for válido
    if (persist && ncm && ncm !== "0000.00.00" && sourceType === "magis5" && sourceAccountId) {
      saveNcmCache.mutate({ accountId: Number(sourceAccountId), sku, ncm });
    }
  }

  function handleUpdateQuantity(sku: string, quantity: number) {
    setProducts((prev) => prev.map((p) => (p.sku === sku ? { ...p, quantity } : p)));
  }

  function handleUpdatePrice(sku: string, price: number) {
    setProducts((prev) => prev.map((p) => (p.sku === sku ? { ...p, price } : p)));
  }

  function handleRemoveProduct(sku: string) {
    setProducts((prev) => prev.filter((p) => p.sku !== sku));
  }

  const [isCheckingProducts, setIsCheckingProducts] = useState(false);
  const [discountPct, setDiscountPct] = useState<string>("");
  const [emitterAccountId, setEmitterAccountId] = useState<string>("");
  const [receiverAccountId, setReceiverAccountId] = useState<string>("");
  const [cloudflareBlocked, setCloudflareBlocked] = useState(false);

  const checkSingleProduct = trpc.bling.checkSingleProduct.useMutation();

  function handleApplyDiscount() {
    const pct = parseFloat(discountPct);
    if (isNaN(pct) || pct <= 0 || pct >= 100) {
      toast.error("Informe uma porcentagem válida entre 0 e 100.");
      return;
    }
    const factor = 1 - pct / 100;
    setProducts((prev) => prev.map((p) => ({ ...p, price: Math.round(p.price * factor * 100) / 100 })));
    toast.success(`Desconto de ${pct}% aplicado em todos os produtos.`);
  }

  function handleGoToStep3() {
    const missingNcm = products.filter((p) => !p.ncm || p.ncm.trim() === "" || p.ncm === "0000.00.00");
    if (missingNcm.length > 0) {
      const nomes = missingNcm.map((p) => p.name).join(", ");
      toast.error(`Preencha o NCM dos seguintes produtos antes de continuar: ${nomes}`, {
        duration: 10000,
      });
      return;
    }
    // Reset checks state
    setProductChecks(products.map((p) => ({ sku: p.sku, name: p.name, status: "pending" as ProductCheckStatus })));
    setChecksDone(false);
    setEmitterAccountId("");
    setReceiverAccountId("");
    setStep(3);
  }

  async function handleStartCheck() {
    if (!emitterAccountId || !receiverAccountId) {
      toast.error("Selecione a conta emissora e a conta destinatária antes de verificar os produtos.");
      return;
    }
    // Marcar todos como "checking"
    setProductChecks(products.map((p) => ({ sku: p.sku, name: p.name, status: "checking" as ProductCheckStatus })));
    setChecksDone(false);
    setIsCheckingProducts(true);

    // Verificar cada produto individualmente em sequência para dar feedback em tempo real
    const updatedChecks: ProductCheckResult[] = products.map((p) => ({ sku: p.sku, name: p.name, status: "checking" as ProductCheckStatus }));

    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      try {
        const result = await checkSingleProduct.mutateAsync({
          sourceAccountId: Number(sourceAccountId),
          destAccountId: Number(emitterAccountId),
          item: {
            productId: p.productId,
            sku: p.sku,
            name: p.name,
            unit: p.unit,
            ncm: p.ncm,
            origem: p.origem,
            cest: p.cest,
            price: p.price,
          },
        });
        updatedChecks[i] = { sku: p.sku, name: p.name, status: result.action === "found" ? "found" : "created" };
      } catch (err: any) {
        updatedChecks[i] = { sku: p.sku, name: p.name, status: "error", error: err.message };
      }
      // Atualizar o estado após cada produto para mostrar progresso em tempo real
      setProductChecks([...updatedChecks]);
    }

    setIsCheckingProducts(false);
    setChecksDone(true);
  }

  function handleConfirmSend() {
    setConfirmOpen(false);
    setProgress(10);

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) {
          clearInterval(interval);
          return 90;
        }
        return prev + 10;
      });
    }, 800);

    sendNFe.mutate({
      sourceAccountId: Number(sourceAccountId),
      destAccountId: Number(emitterAccountId),
      receiverAccountId: isMagis5Receiver ? -1 : Number(receiverAccountId),
      syncDate,
      items: products.map((p) => ({
        productId: p.productId,
        sku: p.sku,
        name: p.name,
        quantity: p.quantity,
        price: p.price,
        unit: p.unit,
        ncm: p.ncm,
        origem: p.origem,
        cest: p.cest,
      })),
    });
  }

  const sourceAccount = accounts.find((a) => a.id === Number(sourceAccountId));
  const emitterAccount = accounts.find((a) => a.id === Number(emitterAccountId));
  const isMagis5Receiver = receiverAccountId === "magis5";
  const receiverAccount = isMagis5Receiver
    ? { id: -1, name: "Magis5 (Mega Facility)", cnpj: "", hasToken: true, tokenExpiresAt: null }
    : accounts.find((a) => a.id === Number(receiverAccountId));
  const totalValue = products.reduce((sum, p) => sum + p.price * p.quantity, 0);



  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Package className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Bling Sync Panel</h1>
              <p className="text-xs text-muted-foreground">Sincronização de pedidos entre contas</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className={`gap-1 cursor-pointer ${
                      accountsStatus.some((a) => a.blocked)
                        ? "text-red-600 border-red-200 bg-red-50"
                        : "text-green-600 border-green-200 bg-green-50"
                    }`}
                  >
                    {accountsStatus.some((a) => a.blocked) ? (
                      <ShieldAlert className="h-3 w-3" />
                    ) : (
                      <CheckCircle2 className="h-3 w-3" />
                    )}
                    {accounts.length} conta{accounts.length !== 1 ? "s" : ""} ativa{accounts.length !== 1 ? "s" : ""}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="p-0 overflow-hidden" sideOffset={6}>
                  <div className="min-w-[240px] bg-popover text-popover-foreground rounded-md border shadow-md">
                    <div className="px-3 py-2 border-b bg-muted/40">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status das Contas</p>
                    </div>
                    {accountsStatus.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">Carregando...</div>
                    ) : (
                      accountsStatus.map((acc) => {
                        // Calcular tempo restante em tempo real usando tick
                        const remaining = acc.unblocksAt
                          ? Math.max(0, new Date(acc.unblocksAt).getTime() - Date.now())
                          : null;
                        const isBlocked = acc.blocked && remaining !== null && remaining > 0;
                        return (
                          <div key={acc.id} className="px-3 py-2.5 flex items-start gap-2.5 border-b last:border-0">
                            <div className="mt-0.5 shrink-0">
                              {isBlocked ? (
                                <ShieldAlert className="h-4 w-4 text-red-500" />
                              ) : (
                                <ShieldCheck className="h-4 w-4 text-green-500" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium leading-tight truncate">{acc.name}</p>
                              {acc.cnpj && (
                                <p className="text-xs text-muted-foreground mt-0.5">{acc.cnpj}</p>
                              )}
                              {isBlocked && remaining !== null ? (
                                <div className="flex items-center gap-1 mt-1">
                                  <Timer className="h-3 w-3 text-red-500" />
                                  <span className="text-xs text-red-600 font-mono font-semibold">
                                    {formatCountdown(remaining)}
                                  </span>
                                  <span className="text-xs text-muted-foreground">para desbloquear</span>
                                </div>
                              ) : (
                                <p className="text-xs text-green-600 mt-0.5">Disponível</p>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button variant="outline" size="sm" onClick={() => setManageAccountsOpen(true)}>
              <Settings className="mr-1 h-4 w-4" />
              Gerenciar Contas
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAddAccountOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Adicionar Conta
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <Tabs defaultValue="sync">
          <TabsList className="mb-6">
            <TabsTrigger value="sync" className="gap-2">
              <Send className="h-4 w-4" />
              Sincronização
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <History className="h-4 w-4" />
              Histórico
            </TabsTrigger>
          </TabsList>

          {/* ─── Sync Tab ─── */}
          <TabsContent value="sync">
            {/* Step indicator */}
            <div className="mb-6 flex items-center gap-2">
              {([1, 2, 3] as Step[]).map((s, idx) => (
                <div key={s} className="flex items-center gap-2">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                      step === s
                        ? "bg-primary text-primary-foreground"
                        : step > s
                        ? "bg-green-500 text-white"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {step > s ? <CheckCircle2 className="h-4 w-4" /> : s}
                  </div>
                  <span
                    className={`text-sm ${
                      step === s ? "font-medium" : "text-muted-foreground"
                    }`}
                  >
                    {s === 1 ? "Buscar Pedidos" : s === 2 ? "Revisar Produtos" : "Enviar Nota"}
                  </span>
                  {idx < 2 && <div className="mx-1 h-px w-8 bg-border" />}
                </div>
              ))}
            </div>

            {/* Step 1 */}
            {step === 1 && (
              <Card>
                <CardHeader>
                  <CardTitle>1. Selecionar Conta e Data</CardTitle>
                  <CardDescription>
                    Escolha a fonte dos pedidos (Bling ou Magis5) e a data que deseja importar.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Banner de bloqueio Cloudflare */}
                  {cloudflareBlocked && (
                    <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                      <span className="mt-0.5 text-lg">⚠️</span>
                      <div>
                        <p className="font-semibold">API do Bling temporariamente bloqueada</p>
                        <p className="mt-1 text-amber-700">O servidor foi bloqueado pelo Cloudflare da API do Bling devido a excesso de requisições. Aguarde <strong>30 a 60 minutos</strong> e tente novamente.</p>
                        <button
                          className="mt-2 text-xs underline text-amber-600 hover:text-amber-800"
                          onClick={() => setCloudflareBlocked(false)}
                        >Fechar aviso</button>
                      </div>
                    </div>
                  )}
                  {/* Seleção de fonte */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Fonte dos Pedidos</label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="sourceType"
                          value="bling"
                          checked={sourceType === "bling"}
                          onChange={(e) => {
                            setSourceType(e.target.value as "bling" | "magis5");
                            setSourceAccountId("");
                          }}
                          className="h-4 w-4"
                        />
                        <span className="text-sm">Bling</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="sourceType"
                          value="magis5"
                          checked={sourceType === "magis5"}
                          onChange={(e) => {
                            setSourceType(e.target.value as "bling" | "magis5");
                            setSourceAccountId("");
                          }}
                          className="h-4 w-4"
                        />
                        <span className="text-sm">Magis5</span>
                      </label>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {sourceType === "bling" && (
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">Conta de Origem</label>
                        <Select value={sourceAccountId} onValueChange={setSourceAccountId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione a conta..." />
                          </SelectTrigger>
                          <SelectContent>
                            {accounts.map((a) => (
                              <SelectItem key={a.id} value={String(a.id)}>
                                {a.name}
                                {a.cnpj && (
                                  <span className="ml-2 text-xs text-muted-foreground">{a.cnpj}</span>
                                )}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {sourceType === "magis5" && (
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">Conta Bling Emissora</label>
                        <Select value={sourceAccountId} onValueChange={setSourceAccountId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione a conta..." />
                          </SelectTrigger>
                          <SelectContent>
                            {accounts.map((a) => (
                              <SelectItem key={a.id} value={String(a.id)}>
                                {a.name}
                                {a.cnpj && (
                                  <span className="ml-2 text-xs text-muted-foreground">{a.cnpj}</span>
                                )}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">Usada para buscar NCM dos produtos</p>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Data dos Pedidos</label>
                      <input
                        type="date"
                        value={syncDate}
                        onChange={(e) => setSyncDate(e.target.value)}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    disabled={
                      (sourceType === "bling" && !sourceAccountId) ||
                      fetchBlingProducts.isPending ||
                      fetchMagis5Products.isPending
                    }
                    onClick={() => {
                      if (sourceType === "bling") {
                        fetchBlingProducts.mutate({
                          accountId: Number(sourceAccountId),
                          date: syncDate,
                        });
                      } else {
                        fetchMagis5Products.mutate({
                          date: syncDate,
                          sourceAccountId: sourceAccountId ? Number(sourceAccountId) : undefined,
                        });
                      }
                    }}
                  >
                    {(fetchBlingProducts.isPending || fetchMagis5Products.isPending) ? (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        Buscando produtos...
                      </>
                    ) : (
                      <>
                        <Package className="mr-2 h-4 w-4" />
                        Buscar Produtos dos Pedidos
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Step 2 */}
            {step === 2 && (
              <Card>
                <CardHeader>
                  <CardTitle>2. Revisar Produtos</CardTitle>
                  <CardDescription>
                    {orderCount} pedido{orderCount !== 1 ? "s" : ""} encontrado{orderCount !== 1 ? "s" : ""} com{" "}
                    {products.length} produto{products.length !== 1 ? "s" : ""} únicos.
                    Preencha o NCM dos produtos destacados antes de avançar.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Campo de desconto percentual */}
                  <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
                    <div className="flex items-center gap-2 flex-1">
                      <label className="text-sm font-medium whitespace-nowrap">Desconto (%):</label>
                      <input
                        type="number"
                        min="0"
                        max="99"
                        step="0.1"
                        placeholder="Ex: 10"
                        value={discountPct}
                        onChange={(e) => setDiscountPct(e.target.value)}
                        className="flex h-9 w-32 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleApplyDiscount}
                      disabled={!discountPct}
                    >
                      Aplicar em todos
                    </Button>
                  </div>
                  <ProductTable
                    products={products}
                    onUpdateNcm={handleUpdateNcm}
                    onUpdateQuantity={handleUpdateQuantity}
                    onUpdatePrice={handleUpdatePrice}
                    onRemove={handleRemoveProduct}
                  />
                  <div className="flex justify-between">
                    <Button variant="outline" onClick={() => setStep(1)}>
                      ← Voltar
                    </Button>
                    <Button onClick={handleGoToStep3}>
                      Avançar para Passo 3 →
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Step 3 */}
            {step === 3 && (
              <Card>
                <CardHeader>
                  <CardTitle>3. Enviar Nota Fiscal</CardTitle>
                  <CardDescription>
                    Selecione a conta destino, verifique os produtos e confirme o envio.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Seleção de emissora e destinatária + resumo */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">Conta Emissora (quem emite a nota)</label>
                        <Select
                          value={emitterAccountId}
                          onValueChange={(v) => { setEmitterAccountId(v); setChecksDone(false); setProductChecks(products.map((p) => ({ sku: p.sku, name: p.name, status: "pending" as ProductCheckStatus }))); }}
                          disabled={isCheckingProducts || sendNFe.isPending}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione a conta emissora..." />
                          </SelectTrigger>
                          <SelectContent>
                            {accounts.map((a) => (
                              <SelectItem key={a.id} value={String(a.id)}>
                                {a.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">Conta Destinatária (quem recebe a nota)</label>
                        <Select
                          value={receiverAccountId}
                          onValueChange={(v) => { setReceiverAccountId(v); setChecksDone(false); setProductChecks(products.map((p) => ({ sku: p.sku, name: p.name, status: "pending" as ProductCheckStatus }))); }}
                          disabled={isCheckingProducts || sendNFe.isPending}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione a conta destinatária..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="magis5">
                              🟢 Magis5 (Mega Facility SP Ltda)
                            </SelectItem>
                            {accounts
                              .map((a) => (
                                <SelectItem key={a.id} value={String(a.id)}>
                                  {a.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Pedidos de:</span>
                        <span className="font-medium">{sourceAccount?.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Emissora:</span>
                        <span className="font-medium">{emitterAccount?.name ?? "—"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Destinatária:</span>
                        <span className="font-medium">{receiverAccount?.name ?? "—"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Produtos:</span>
                        <span className="font-medium">{products.length}</span>
                      </div>
                      <div className="flex justify-between border-t pt-1.5">
                        <span className="font-medium">Total:</span>
                        <span className="font-bold text-primary">
                          {totalValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Painel de verificação de produtos */}
                  <div className="rounded-lg border overflow-hidden">
                    <div className="flex items-center justify-between bg-muted/40 px-4 py-2.5 border-b">
                      <div className="flex items-center gap-2">
                        <Search className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Verificação de Produtos na Conta Destino</span>
                      </div>
                      {!checksDone && !isCheckingProducts && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!emitterAccountId || !receiverAccountId}
                          onClick={handleStartCheck}
                        >
                          <Search className="mr-1.5 h-3.5 w-3.5" />
                          Verificar Produtos
                        </Button>
                      )}
                      {checksDone && (
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1 text-green-600">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {productChecks.filter((p) => p.status === "found").length} já cadastrado{productChecks.filter((p) => p.status === "found").length !== 1 ? "s" : ""}
                          </span>
                          <span className="flex items-center gap-1 text-blue-600">
                            <Plus className="h-3.5 w-3.5" />
                            {productChecks.filter((p) => p.status === "created").length} cadastrado{productChecks.filter((p) => p.status === "created").length !== 1 ? "s" : ""} agora
                          </span>
                        </div>
                      )}
                    </div>

                    {productChecks.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-sm gap-2">
                        <Search className="h-8 w-8 opacity-30" />
                        <p>Selecione a conta destino e clique em <strong>Verificar Produtos</strong></p>
                      </div>
                    ) : (
                      <div className="max-h-64 overflow-y-auto divide-y">
                        {productChecks.map((pc) => (
                          <div key={pc.sku} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/20">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-mono text-xs text-muted-foreground shrink-0">{pc.sku}</span>
                              <span className="truncate">{pc.name}</span>
                            </div>
                            <div className="shrink-0 ml-3">
                              {pc.status === "pending" && (
                                <Badge variant="outline" className="text-muted-foreground gap-1">
                                  <Clock className="h-3 w-3" /> Aguardando
                                </Badge>
                              )}
                              {pc.status === "checking" && (
                                <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50 gap-1">
                                  <Loader2 className="h-3 w-3 animate-spin" /> Verificando...
                                </Badge>
                              )}
                              {pc.status === "found" && (
                                <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 gap-1">
                                  <CheckCircle2 className="h-3 w-3" /> Já cadastrado
                                </Badge>
                              )}
                              {pc.status === "created" && (
                                <Badge variant="outline" className="text-blue-700 border-blue-200 bg-blue-50 gap-1">
                                  <Plus className="h-3 w-3" /> Cadastrado agora
                                </Badge>
                              )}
                              {pc.status === "error" && (
                                <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50 gap-1">
                                  <XCircle className="h-3 w-3" /> Erro
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Barra de progresso do envio */}
                  {sendNFe.isPending && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Criando nota fiscal...</span>
                        <span className="font-medium">{progress}%</span>
                      </div>
                      <Progress value={progress} className="h-2" />
                    </div>
                  )}

                  <div className="flex justify-between">
                    <Button variant="outline" onClick={() => setStep(2)} disabled={isCheckingProducts || sendNFe.isPending}>
                      ← Voltar
                    </Button>
                    <Button
                      disabled={!emitterAccountId || !receiverAccountId || !checksDone || sendNFe.isPending}
                      onClick={() => setConfirmOpen(true)}
                    >
                      {sendNFe.isPending ? (
                        <>
                          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                          Enviando...
                        </>
                      ) : (
                        <>
                          <Send className="mr-2 h-4 w-4" />
                          Enviar Nota Fiscal
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ─── History Tab ─── */}
          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle>Histórico de Sincronizações</CardTitle>
                <CardDescription>Registro de todas as notas fiscais criadas.</CardDescription>
              </CardHeader>
              <CardContent>
                {history.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <History className="mb-3 h-10 w-10 opacity-30" />
                    <p>Nenhuma sincronização realizada ainda.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Data</th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Nota</th>
                          <th className="px-3 py-2 text-center font-medium text-muted-foreground">Status</th>
                          <th className="px-3 py-2 text-center font-medium text-muted-foreground">Itens</th>
                          <th className="px-3 py-2 text-right font-medium text-muted-foreground">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((h) => (
                          <tr key={h.id} className="border-t hover:bg-muted/30">
                            <td className="px-3 py-2 text-muted-foreground">
                              <div className="flex items-center gap-1.5">
                                <Clock className="h-3.5 w-3.5" />
                                {new Date(h.createdAt).toLocaleString("pt-BR")}
                              </div>
                            </td>
                            <td className="px-3 py-2 font-mono">
                              {h.nfeNumber ? `#${h.nfeNumber}` : "—"}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <Badge
                                variant={
                                  h.status === "success"
                                    ? "default"
                                    : h.status === "partial"
                                    ? "secondary"
                                    : "destructive"
                                }
                                className={
                                  h.status === "success"
                                    ? "bg-green-100 text-green-700 hover:bg-green-100"
                                    : ""
                                }
                              >
                                {h.status === "success"
                                  ? "Sucesso"
                                  : h.status === "partial"
                                  ? "Parcial"
                                  : "Erro"}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-center">{h.totalItems}</td>
                            <td className="px-3 py-2 text-right font-medium">
                              {h.totalValue
                                ? Number(h.totalValue).toLocaleString("pt-BR", {
                                    style: "currency",
                                    currency: "BRL",
                                  })
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Add Account Modal */}
      <AddAccountModal
        open={addAccountOpen}
        onClose={() => setAddAccountOpen(false)}
        onSuccess={() => utils.bling.listAccounts.invalidate()}
      />

      {/* Manage Accounts Modal */}
      <ManageAccountsModal
        open={manageAccountsOpen}
        onClose={() => setManageAccountsOpen(false)}
        accounts={accounts}
        onSuccess={() => {
          utils.bling.listAccounts.invalidate();
          utils.bling.getAccountsStatus.invalidate();
        }}
      />

      {/* Confirmation Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar envio da nota fiscal</DialogTitle>
            <DialogDescription>
              Você está prestes a criar uma nota fiscal emitida por{" "}
              <strong>{emitterAccount?.name}</strong> para{" "}
              <strong>{receiverAccount?.name}</strong> com {products.length} produto
              {products.length !== 1 ? "s" : ""} no valor total de{" "}
              <strong>
                {totalValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </strong>
              .
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Origem:</span>
              <span>{sourceAccount?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Emissora:</span>
              <span>{emitterAccount?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Destinatária:</span>
              <span>{receiverAccount?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Natureza:</span>
              <span>Venda de mercadoria com ST</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmSend}>
              <Send className="mr-2 h-4 w-4" />
              Confirmar e Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
