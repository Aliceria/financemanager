
# Finance Manager

Gerenciador de financas pessoal feito com Node.js, TypeScript, Express,
SQLite, cookies e sessoes.

## Como rodar

```bash
npm install
copy .env.example .env
npm run dev
```

Depois abra `http://localhost:3000`.

O usuario inicial e `admin`. A senha vem de `DEFAULT_ADMIN_PASSWORD` no arquivo
`.env`.

## Privacidade

O sistema funciona localmente e nao usa APIs externas para processar dados
financeiros. Dados de login usam hash com bcrypt. Arquivos sensiveis como
`.env`, bancos SQLite, `node_modules` e `dist` ficam fora do Git pelo
`.gitignore`.

## Funcionalidades

- Login com sessao e cookie.
- Logout.
- Dashboard protegida.
- Selecao de data ate 1 ano a frente.
- Cadastro de renda mensal.
- Cadastro, edicao e remocao de gastos fixos.
- Cadastro, edicao e remocao de gastos percentuais.
- Cadastro, edicao e remocao de gastos variaveis mensais.
- Previsao financeira mes a mes.
