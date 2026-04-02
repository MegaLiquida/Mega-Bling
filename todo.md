# Bling Sync Panel — TODO

## Banco de dados
- [x] Adicionar tabelas bling_accounts e sync_history no schema Drizzle
- [x] Gerar e aplicar migração SQL

## Servidor
- [x] Implementar server/blingService.ts (API Bling v3, rate limiting, retry)
- [x] Implementar server/db.ts com helpers para bling_accounts e sync_history
- [x] Implementar server/routers.ts com todos os endpoints tRPC
- [x] Adicionar endpoint /api/bling/callback para OAuth Bling

## Frontend
- [x] Atualizar index.css com tema visual (azul/branco, fonte Inter)
- [x] Criar componente AddAccountModal.tsx
- [x] Criar componente ProductTable.tsx com NCM editável
- [x] Implementar Home.tsx com 3 passos (Buscar Pedidos → Revisar Produtos → Enviar Nota)
- [x] Implementar aba Histórico com lista de sincronizações
- [x] Atualizar App.tsx com layout e rotas

## Scripts e testes
- [x] Criar scripts/check_ncm.mjs para auditoria de NCM
- [x] Escrever testes vitest para routers principais (9 testes passando)

## Entrega
- [x] Salvar checkpoint final

## Bugs
- [x] Criar contato automaticamente na conta destino se não encontrado pelo CNPJ (em vez de lançar erro)
- [x] Corrigir payload NFe: data de operação inválida e numeroDocumento do contato não informado
- [x] Tornar campos quantidade e preço editáveis na tabela de produtos
- [x] Garantir botão de exclusão de produto funcional na tabela
- [x] Verificar e cadastrar produtos automaticamente na conta destino antes de emitir NFe
- [x] Implementar renovação automática de tokens Bling em segundo plano (job periódico)
- [x] Corrigir erro "Data de operação inválida" no payload da NFe (formato ISO 8601 com timezone -03:00)
- [x] Corrigir preenchimento de endereço e município do destinatário na NFe via BrasilAPI
- [x] Contato encontrado mas tipo=Física e endereço vazio: corrigido incluindo tipoPessoa J, contribuinte e endereço BrasilAPI direto no payload da NFe
- [x] Remover obrigatoriedade de login: sistema acessível sem autenticação
- [x] Otimizar performance da busca de pedidos: paralelizar requisições e reduzir delays
- [x] Painel de progresso visual no Passo 3: mostrar status de cada produto (verificando, já cadastrado, cadastrando, cadastrado)

## Dados das contas
- [x] Inserir Bling 1 - Principal (41.605.996/0001-46) no banco de dados
- [x] Inserir Casa de Eletronicos Importacao e Varejo LTDA (61.899.286/0001-83) no banco de dados
- [x] Corrigir unidade padrão: todos os produtos devem ter "UN" quando o campo unidade estiver vazio
- [x] Corrigir painel de verificação travado em "Verificando..." — nunca conclui
- [x] Investigar busca de pedidos retornando vazia — estava funcionando e parou
- [x] Corrigir timeout na busca: operação demora 2+ min e tRPC encerra antes de terminar
- [x] Corrigir cache NCM: não cachear NCM vazio — produtos com NCM no Bling aparecem como "0000.00.00"
- [x] Corrigir busca de pedidos que não retorna resultados para conta "Casa de Eletronicos Importacao e Varejo LTDA"
- [x] Corrigir timeout em buscas com 150+ pedidos: reduzir paralelismo e aumentar timeout do servidor
- [x] Corrigir erro "Unexpected token '<'" — timeout do servidor retornando HTML em vez de JSON
- [x] Corrigir lentidão no envio da nota fiscal — deveria ser rápido pois todos os dados já estão prontos
- [x] Corrigir criação duplicada de contato: usar contato existente pelo CNPJ em vez de criar novo
- [x] Etapa 2: campo de porcentagem de desconto massivo no topo da tabela de produtos
- [x] Etapa 3: seleção livre de conta emissora e conta destinatária no envio da nota

## Integração Magis5
- [x] Testar API Magis5 e mapear estrutura dos pedidos faturados
- [x] Criar magis5Service.ts com busca de pedidos e extração de produtos
- [x] Adicionar Magis5 como fonte na Etapa 1 do frontend
- [x] Adicionar endpoints no routers.ts e token como secret
- [x] Buscar NCM automaticamente dos produtos Magis5 pelo XML da NFe (campo <NCM> por EAN)
- [x] Corrigir lista de contas destinatárias na Etapa 3 — todas as contas devem aparecer (não filtrar pela emissora)
- [ ] Adicionar Magis5 como opção de conta destinatária na Etapa 3

## Status de contas com contador de bloqueio Cloudflare
- [x] Criar endpoint getAccountsStatus que retorna status de bloqueio de cada conta (em memória no servidor)
- [x] Armazenar timestamp do último bloqueio detectado por conta (em memória no servidor)
- [x] Implementar tooltip no badge "2 contas ativas" com status de cada conta e contador regressivo
