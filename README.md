
# Finance Manager

```bash
npm install
copy .env.example .env
npm run dev
```

Em conformidade com a LGPD, este projeto coleta apenas os dados estritamente necessários para seu funcionamento. Atualmente, o único dado pessoal utilizado para identificação do usuário é o endereço de e-mail, empregado exclusivamente para autenticação e gerenciamento da conta. Os dados armazenados são protegidos por medidas de segurança apropriadas e não são compartilhados com terceiros

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
- Historico mensal real por perfil, com fechamento de renda, gastos e saldo.
