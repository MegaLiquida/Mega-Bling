# Fontes oficiais — correção das contas Bling 1 e 2

## Bling API — introdução e autenticação

Fonte: https://developer.bling.com.br/bling-api

A documentação oficial informa que a API Bling v3 utiliza OAuth 2.0, tokens Bearer e HTTPS. As requisições autenticadas devem usar o cabeçalho `Authorization: Bearer [access_token]` e a base de produção `https://api.bling.com.br/Api/v3`.

A documentação também confirma que um aplicativo somente obtém os tokens necessários depois que o usuário autoriza explicitamente o acesso aos recursos da conta. Portanto, um `refresh_token` rejeitado não deve ser substituído por valor inventado; a conta precisa passar novamente pelo fluxo de autorização OAuth.

A página dinâmica de referência indica uma categoria “Empresas”, mas seu conteúdo não foi retornado pelo extrator textual. O endpoint específico para dados básicos da empresa ainda precisa ser confirmado antes de qualquer uso para preencher CNPJ.

## Bling — cadastro de aplicativos e reautorização

Fonte: https://developer.bling.com.br/aplicativos

O manual oficial estabelece que:

- O `refresh_token` possui validade superior à do access token, informada como 30 dias; quando ele deixa de ser aceito, é necessário obter novos tokens pelo fluxo Authorization Code.
- Em **Central de Extensões > Minhas instalações**, uma instalação pode ser **reautenticada** quando os códigos de acesso expiraram.
- O link de redirecionamento e os escopos são definidos no cadastro do aplicativo. O aplicativo somente acessa recursos cujos escopos foram autorizados.
- Alterar a lista de escopos e confirmar a edição revoga automaticamente os usuários instalados, exigindo nova autorização.
- A troca do authorization code por tokens deve ocorrer no servidor e o código expira em um minuto.

## Bling — dados básicos da empresa

Fonte primária: especificação OpenAPI servida por https://developer.bling.com.br/build/assets/openapi-D-189jcU.json

Endpoint oficial: `GET /empresas/me/dados-basicos`.

Descrição oficial: retorna CNPJ, razão social e e-mail da empresa autenticada. Requer o recurso `Empresas`, ação `Obter`. A consulta real retornou HTTP 403 para a Conta 2, demonstrando que a instalação/token atual não possui esse escopo; portanto, o CNPJ da Conta 2 não pode ser preenchido automaticamente por esse endpoint sem ampliar o escopo e reautorizar, ou sem o responsável informar o CNPJ correto.
