# Finance Manager

Sistema simples de controle financeiro pessoal feito com Node.js, TypeScript,
Express e SQLite.

A ideia do projeto é permitir que uma pessoa registre renda, gastos e metas
financeiras em perfis separados, como casa, faculdade, trabalho ou qualquer
outro planejamento que ela queira acompanhar.

- [Levantamento de requisitos](./requisitos.md)
- [Diagrama Entidade Relacionamento](./DiagramaER.md)

## Índice

- [Funcionalidades](#funcionalidades)
- [Como rodar](#como-rodar)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Fluxo do sistema](#fluxo-do-sistema)
- [Rotas principais](#rotas-principais)
- [Banco de dados](#banco-de-dados)
- [Privacidade](#privacidade)

## Funcionalidades

- cadastro de usuário
- login com sessão e cookie
- logout
- dashboard protegida
- criação e seleção de perfis financeiros
- perfil padrão criado automaticamente para novos usuários
- cadastro de renda mensal
- cadastro, edição e remoção de gastos fixos
- cadastro, edição e remoção de gastos percentuais
- cadastro, edição e remoção de gastos variáveis
- metas financeiras com previsão de mês/ano
- gráfico simples com entrada, gastos e saldo
- previsão financeira por data
- histórico mensal real por perfil

## Como rodar

Instale as dependências:

```bash
npm install
```

Crie um arquivo `.env` na raiz do projeto e configure as variáveis necessárias.

Depois rode em modo desenvolvimento:

```bash
npm run dev
```

Para gerar a versão compilada:

```bash
npm run build
```

Para rodar a versão compilada:

```bash
npm start
```

Por padrão, o sistema abre em:

```text
http://localhost:3000
```

## Variáveis de ambiente

O projeto usa um arquivo `.env` local. Ele não deve ser enviado para o Git.

Variáveis usadas:

```env
SESSION_SECRET=uma_chave_para_assinar_a_sessao
DEFAULT_ADMIN_PASSWORD=senha_do_usuario_admin_inicial
PORT=3000
```

`SESSION_SECRET` é obrigatória para iniciar o servidor.

`DEFAULT_ADMIN_PASSWORD` cria o usuário `admin` automaticamente, caso ele ainda
não exista no banco.

`PORT` é opcional. Se não for informada, o sistema usa a porta `3000`.

## Estrutura do projeto

```text
financemanager/
+-- src/
|   +-- index.ts
+-- data/
|   +-- financemanager.sqlite
+-- dist/
+-- package.json
+-- tsconfig.json
+-- README.md
+-- requisitos.md
```

O arquivo principal é o `src/index.ts`. Nele ficam as rotas, a configuração do
Express, a criação das tabelas e a renderização das páginas HTML.

A pasta `data/` guarda o banco SQLite local e os dados de sessão. Ela fica fora
do Git.

A pasta `dist/` é gerada pelo TypeScript quando o comando `npm run build` é
executado.

## Fluxo do sistema

Quando uma pessoa acessa o sistema sem estar logada, ela é enviada para a tela
de login.

Na tela de login existe a opção de criar conta. Ao registrar um novo usuário, o
sistema já cria um perfil chamado `Padrão` e abre a dashboard desse perfil.

Dentro da dashboard, o usuário pode criar outros perfis. Cada perfil tem seus
próprios dados financeiros, então o planejamento da casa não se mistura com o
planejamento da faculdade, por exemplo.

O saldo mensal é calculado assim:

```text
renda mensal - gastos fixos - gastos percentuais - gastos variáveis
```

As metas financeiras usam esse saldo mensal para estimar em qual mês e ano o
valor poderá ser alcançado.

O histórico mensal permite salvar um fechamento real do mês atual ou de outro
mês selecionado. Esse fechamento guarda renda, gastos e saldo daquele momento.

## Rotas principais

### Autenticação

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/login` | mostra a tela de login |
| `POST` | `/login` | autentica o usuário |
| `GET` | `/register` | mostra a tela de cadastro |
| `POST` | `/register` | cria uma conta e o perfil padrão |
| `POST` | `/logout` | encerra a sessão |

### Dashboard e perfis

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/` | redireciona para login ou dashboard |
| `GET` | `/dashboard` | mostra o painel financeiro |
| `POST` | `/profiles` | cria um novo perfil financeiro |
| `POST` | `/profiles/select` | muda o perfil ativo |

### Dados financeiros

| Método | Rota | Descrição |
| --- | --- | --- |
| `POST` | `/income` | salva a renda mensal do perfil |
| `POST` | `/expenses/fixed` | adiciona gasto fixo |
| `POST` | `/expenses/:id/fixed` | edita gasto fixo |
| `POST` | `/expenses/percentage` | adiciona gasto percentual |
| `POST` | `/expenses/:id/percentage` | edita gasto percentual |
| `POST` | `/expenses/variable` | adiciona gasto variável |
| `POST` | `/expenses/:id/variable` | edita gasto variável |
| `POST` | `/expenses/:id/delete` | remove um gasto |

### Metas e histórico

| Método | Rota | Descrição |
| --- | --- | --- |
| `POST` | `/goals` | adiciona uma meta financeira |
| `POST` | `/goals/:id` | edita uma meta |
| `POST` | `/goals/:id/delete` | remove uma meta |
| `POST` | `/history/save` | salva o fechamento mensal |
| `POST` | `/history/:id/delete` | remove um fechamento mensal |

## Banco de dados

O banco usado é SQLite.

As principais tabelas são:

- `users`: usuários do sistema
- `profiles`: perfis financeiros de cada usuário
- `profile_settings`: renda mensal de cada perfil
- `expenses`: gastos fixos, percentuais e variáveis
- `financial_goals`: metas financeiras
- `monthly_history`: histórico mensal real
- `sessions`: sessões criadas pelo Express

As senhas são armazenadas com hash usando `bcrypt`.

## Privacidade

O sistema funciona localmente e não usa APIs externas para processar dados
financeiros.

O arquivo `.env`, o banco SQLite, a pasta `data/`, a pasta `dist/` e
`node_modules/` não devem ser enviados para o repositório.

Os dados financeiros cadastrados ficam no banco SQLite local.
