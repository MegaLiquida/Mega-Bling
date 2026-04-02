import { AlertTriangle, CheckCircle2, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";

export interface ProductItem {
  productId: number;
  sku: string;
  name: string;
  quantity: number;
  price: number;
  unit: string;
  ncm?: string;
  origem?: number;
  cest?: string;
}

interface ProductTableProps {
  products: ProductItem[];
  onUpdateNcm?: (sku: string, ncm: string, persist?: boolean) => void;
  onUpdateQuantity?: (sku: string, quantity: number) => void;
  onUpdatePrice?: (sku: string, price: number) => void;
  onRemove?: (sku: string) => void;
}

export function ProductTable({
  products,
  onUpdateNcm,
  onUpdateQuantity,
  onUpdatePrice,
  onRemove,
}: ProductTableProps) {
  const missingNcmCount = products.filter(
    (p) => !p.ncm || p.ncm.trim() === "" || p.ncm === "0000.00.00"
  ).length;

  return (
    <div className="space-y-2">
      {missingNcmCount > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>{missingNcmCount}</strong> produto{missingNcmCount > 1 ? "s" : ""} sem NCM.
            Preencha o campo NCM antes de avançar.
          </span>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">SKU</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Produto</th>
              <th className="px-3 py-2 text-center font-medium text-muted-foreground">NCM</th>
              <th className="px-3 py-2 text-center font-medium text-muted-foreground w-24">Qtd</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground w-32">Preço Un.</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Total</th>
              <th className="px-3 py-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {products.map((product) => {
              const hasNcm =
                product.ncm &&
                product.ncm.trim() !== "" &&
                product.ncm !== "0000.00.00";
              return (
                <tr
                  key={product.sku}
                  className={`border-t transition-colors ${
                    !hasNcm ? "bg-red-50 hover:bg-red-100/70" : "hover:bg-muted/30"
                  }`}
                >
                  {/* SKU */}
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {product.sku}
                  </td>

                  {/* Nome */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {!hasNcm && (
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-orange-500" />
                      )}
                      <span className="font-medium">{product.name}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{product.unit}</div>
                  </td>

                  {/* NCM */}
                  <td className="px-3 py-2 text-center">
                    {hasNcm ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        <CheckCircle2 className="h-3 w-3" />
                        {product.ncm}
                      </span>
                    ) : (
                      <Input
                        className="h-7 w-28 border-orange-300 bg-orange-50 text-center text-xs focus:border-orange-500"
                        placeholder="0000.00.00"
                        defaultValue=""
                        onChange={(e) => onUpdateNcm?.(product.sku, e.target.value)}
                        onBlur={(e) => onUpdateNcm?.(product.sku, e.target.value, true)}
                      />
                    )}
                  </td>

                  {/* Quantidade editável */}
                  <td className="px-3 py-2 text-center">
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      className="h-7 w-20 text-center text-xs"
                      value={product.quantity}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val) && val > 0) {
                          onUpdateQuantity?.(product.sku, val);
                        }
                      }}
                    />
                  </td>

                  {/* Preço editável */}
                  <td className="px-3 py-2 text-right">
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      className="h-7 w-28 text-right text-xs"
                      value={product.price}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val) && val >= 0) {
                          onUpdatePrice?.(product.sku, val);
                        }
                      }}
                    />
                  </td>

                  {/* Total */}
                  <td className="px-3 py-2 text-right font-medium">
                    {(product.price * product.quantity).toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    })}
                  </td>

                  {/* Excluir */}
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => onRemove?.(product.sku)}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                      title="Remover produto"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-muted/30">
            <tr>
              <td colSpan={4} className="px-3 py-2 text-sm font-medium">
                Total ({products.length} produto{products.length !== 1 ? "s" : ""})
              </td>
              <td colSpan={2} className="px-3 py-2 text-right text-sm font-bold">
                {products
                  .reduce((sum, p) => sum + p.price * p.quantity, 0)
                  .toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
