# Análise Completa do Log — Bling Sync Panel

## Erros Identificados

### 1. Erro 429 na renovação de token da Conta 1 (linha 4)
```
[BlingService] Token inválido na conta 1; renovando e repetindo a requisição...
[BlingService] Falha ao renovar token da conta 1: Request failed with status code 429
```
- Token da Conta 1 já estava inválido
- Tentativa de renovação falhou com 429 (rate limit da API Bling)
- O sistema continuou funcionando com as contas 2 e 3

### 2. Erro ao salvar cache NCM (centenas de ocorrências)
```
[extractProducts] Erro ao salvar cache NCM para <SKU>: Failed query: insert into "ncm_cache"
... on conflict ("accountId","sku") do update set ...
```
- **Todas** as gravações de NCM na tabela `ncm_cache` falham
- Causa: a constraint `ON CONFLICT ("accountId","sku")` exige um índice único em `(accountId, sku)`
- O código espera essa constraint, mas o banco pode não tê-la aplicada
- Impacto: cache NCM não funciona, mas a extração continua (NCM é obtido da API e usado na NFe)

### 3. CNPJ destinatária: undefined (linhas 985, 1408)
```
[sendSaleNFe] Emissora: Bling 2 | Destinatária: Bling 2 | CNPJ destinatária: undefined
[sendSaleNFe] Emissora: Bling 2 | Destinatária: Bling 3 | CNPJ destinatária: undefined
```
- As contas 2 e 3 não têm campo `cnpj` preenchido na tabela `bling_accounts`
- Isso pode causar rejeição na emissão da NFe

### 4. Token da Conta 1: Invalid refresh token (linha 1422)
```
[BlingService] Token inválido na conta 1; renovando e repetindo a requisição...
[BlingService] Falha ao renovar token da conta 1: Invalid refresh token
```
- O refresh_token da Conta 1 é inválido/expirado
- A Conta 1 precisa de novas credenciais do Bling

### 5. Account2 Missing session cookie (centenas de ocorrências)
```
[Auth] Missing session cookie
```
- Ruído do middleware de autenticação — não afeta o fluxo Bling
- O sistema não exige login, então esses warnings são esperados

## Causas Raiz

| Erro | Causa | Impacto | Prioridade |
|---|---|---|---|
| 429 na renovação token Conta 1 | Rate limit da API Bling | Conta 1 inoperante | ALTA |
| Falha NCM cache | Constraint única ausente em `(accountId, sku)` | Cache não persiste, NCM obtido a cada extração | MÉDIA |
| CNPJ undefined | Campos `cnpj` vazios nas contas 2 e 3 | Risco de rejeição na NFe | ALTA |
| Invalid refresh token Conta 1 | Token expirado | Conta 1 inoperante | ALTA |

## Resumo do Fluxo Observado

O sistema processou com sucesso as contas 2 e 3:
- Conta 2 (Bling 2): 35 pedidos, 34 produtos, NCM obtido, NFe montada
- Conta 3 (Bling 3): 23 pedidos, 16 produtos (no log anterior)
- NFe foi montada corretamente com itens, preços e NCM
- O erro final (linha 1421-1422) ocorreu ao tentar acessar a Conta 1 para alguma operação adicional
