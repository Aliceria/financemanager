# Levantamento de Requisitos

## 1. Visão geral

O Finance Manager é uma aplicação web de controle financeiro pessoal. O sistema
permite que o usuário crie uma conta, acesse uma dashboard protegida e organize
seus dados financeiros por perfis separados.

A aplicação foi desenvolvida com Node.js, TypeScript, Express e SQLite. As telas
são geradas no servidor pelo arquivo `src/index.ts`.

## 2. Arquivos analisados

Este levantamento foi feito com base nos arquivos do projeto:

- `src/index.ts`
- `README.md`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `index.js`
- `.gitignore`

Arquivos gerados, sensíveis ou locais não fazem parte do levantamento, como
`.env`, `node_modules/`, `dist/` e `data/`.

## 3. Objetivo do sistema

O objetivo do sistema é permitir que uma pessoa acompanhe renda, gastos,
previsões, metas financeiras e histórico mensal em um ambiente simples e local.

O sistema também permite separar planejamentos financeiros em perfis diferentes,
como casa, faculdade, pessoal ou qualquer outro nome criado pelo usuário.

## 4. Escopo do sistema

O sistema contempla:

- cadastro de usuário
- login e logout
- controle de sessão com cookie
- dashboard protegida
- criação e seleção de perfis financeiros
- cadastro de renda mensal
- cadastro de gastos fixos
- cadastro de gastos percentuais
- cadastro de gastos variáveis
- cálculo de saldo mensal
- previsão financeira por data
- metas financeiras
- gráfico financeiro simples
- histórico mensal real
- armazenamento local em SQLite

O sistema não contempla, no estado atual:

- API pública em JSON
- recuperação de senha
- envio de e-mail
- área administrativa separada
- múltiplos níveis de permissão

## 5. Atores

### Visitante

Usuário que ainda não está autenticado.

Pode:

- acessar a tela de login
- acessar a tela de cadastro
- criar uma conta

### Usuário autenticado

Usuário que possui conta e sessão ativa.

Pode:

- acessar a dashboard
- criar perfis financeiros
- selecionar o perfil ativo
- cadastrar renda
- cadastrar, editar e remover gastos
- cadastrar, editar e remover metas
- salvar histórico mensal
- remover histórico mensal
- sair da conta

## 6. Requisitos funcionais

### RF01 - Cadastro de usuário

O sistema deve permitir o cadastro de novos usuários.

Critérios:

- o usuário deve informar nome de usuário e senha
- o nome de usuário deve ter no mínimo 3 caracteres
- a senha deve ter no mínimo 6 caracteres
- nomes de usuário repetidos não devem ser aceitos
- a senha deve ser salva com hash
- após o cadastro, o usuário deve ser autenticado automaticamente
- após o cadastro, deve ser criado um perfil financeiro padrão

### RF02 - Login

O sistema deve permitir que usuários cadastrados façam login.

Critérios:

- o usuário deve informar nome de usuário e senha
- a senha informada deve ser comparada com o hash salvo no banco
- em caso de dados inválidos, o sistema deve exibir mensagem de erro
- em caso de sucesso, o sistema deve criar uma sessão
- após o login, o usuário deve ser redirecionado para a dashboard

### RF03 - Logout

O sistema deve permitir que o usuário encerre a sessão.

Critérios:

- a sessão deve ser destruída no servidor
- o cookie da sessão deve ser limpo
- o usuário deve ser redirecionado para a tela de login

### RF04 - Proteção de rotas

O sistema deve impedir o acesso à dashboard e às ações financeiras sem login.

Critérios:

- usuários sem sessão devem ser redirecionados para `/login`
- usuários autenticados devem conseguir acessar `/dashboard`
- operações de renda, gastos, perfis, metas e histórico devem exigir login

### RF05 - Perfil financeiro padrão

O sistema deve criar um perfil financeiro padrão para cada usuário.

Critérios:

- o perfil padrão deve ser criado no cadastro do usuário
- se um usuário antigo não tiver perfil, o sistema deve criar um ao carregar seus dados
- o perfil padrão deve ser usado como perfil ativo inicial

### RF06 - Criação de perfis financeiros

O sistema deve permitir que o usuário crie novos perfis financeiros.

Critérios:

- cada perfil deve pertencer ao usuário logado
- o nome do perfil deve ser informado pelo usuário
- o sistema não deve duplicar perfis com o mesmo nome para o mesmo usuário
- ao criar um perfil, ele passa a ser o perfil ativo

### RF07 - Seleção de perfil ativo

O sistema deve permitir que o usuário altere o perfil financeiro ativo.

Critérios:

- somente perfis do usuário logado podem ser selecionados
- o perfil ativo deve ser armazenado na sessão
- os dados da dashboard devem ser carregados com base no perfil ativo

### RF08 - Cadastro de renda mensal

O sistema deve permitir cadastrar ou atualizar a renda mensal do perfil ativo.

Critérios:

- a renda deve ser informada como valor monetário
- o valor deve ser convertido para centavos antes de salvar
- valores negativos ou inválidos devem ser tratados como zero
- a renda deve ser considerada nos cálculos do painel

### RF09 - Cadastro de gastos fixos

O sistema deve permitir cadastrar gastos fixos.

Critérios:

- o gasto deve ter nome e valor
- o gasto deve pertencer ao usuário logado
- o gasto deve pertencer ao perfil ativo
- o valor deve ser convertido para centavos

### RF10 - Edição de gastos fixos

O sistema deve permitir editar gastos fixos existentes.

Critérios:

- só deve ser possível editar gastos do usuário logado
- só deve ser possível editar gastos do perfil ativo
- o nome e o valor podem ser atualizados

### RF11 - Cadastro de gastos percentuais

O sistema deve permitir cadastrar gastos calculados por percentual da renda.

Critérios:

- o gasto deve ter nome e percentual
- o percentual deve ser salvo em pontos-base
- percentuais negativos devem virar zero
- percentuais acima de 100% devem ser limitados a 100%
- o valor em dinheiro deve ser calculado com base na renda mensal

### RF12 - Edição de gastos percentuais

O sistema deve permitir editar gastos percentuais existentes.

Critérios:

- só deve ser possível editar gastos do usuário logado
- só deve ser possível editar gastos do perfil ativo
- o nome e o percentual podem ser atualizados

### RF13 - Cadastro de gastos variáveis

O sistema deve permitir cadastrar gastos variáveis.

Critérios:

- o gasto deve ter nome e valor
- o valor salvo deve ser usado no cálculo atual do perfil
- o gasto deve pertencer ao usuário logado e ao perfil ativo

### RF14 - Edição de gastos variáveis

O sistema deve permitir editar gastos variáveis existentes.

Critérios:

- só deve ser possível editar gastos do usuário logado
- só deve ser possível editar gastos do perfil ativo
- o nome e o valor podem ser atualizados

### RF15 - Remoção de gastos

O sistema deve permitir remover gastos cadastrados.

Critérios:

- a remoção deve validar usuário logado
- a remoção deve validar perfil ativo
- a remoção deve aceitar gastos fixos, percentuais e variáveis

### RF16 - Resumo financeiro

O sistema deve exibir um resumo financeiro do perfil ativo.

Critérios:

- mostrar renda mensal
- mostrar total de gastos fixos
- mostrar total de gastos percentuais
- mostrar total de gastos variáveis
- mostrar total geral de gastos
- mostrar saldo mensal
- mostrar saldo acumulado conforme a data selecionada

### RF17 - Previsão financeira por data

O sistema deve permitir selecionar uma data para previsão financeira.

Critérios:

- a data mínima deve ser a data atual
- a data máxima deve ser um ano após a data atual
- se a data for inválida, o sistema deve usar a data atual
- se a data passar do limite, o sistema deve limitar ao máximo permitido
- a previsão deve mostrar os meses entre a data atual e a data selecionada

### RF18 - Tabela de previsão

O sistema deve exibir uma tabela de previsão mês a mês.

Critérios:

- mostrar mês
- mostrar renda
- mostrar gastos fixos
- mostrar gastos percentuais
- mostrar gastos variáveis
- mostrar saldo mensal
- mostrar saldo acumulado

### RF19 - Metas financeiras

O sistema deve permitir cadastrar metas financeiras.

Critérios:

- a meta deve ter nome e valor alvo
- a meta deve pertencer ao usuário logado
- a meta deve pertencer ao perfil ativo
- metas com valor zero ou inválido não devem ser salvas

### RF20 - Edição de metas financeiras

O sistema deve permitir editar metas financeiras.

Critérios:

- só deve ser possível editar metas do usuário logado
- só deve ser possível editar metas do perfil ativo
- o nome e o valor alvo podem ser atualizados

### RF21 - Remoção de metas financeiras

O sistema deve permitir remover metas financeiras.

Critérios:

- só deve ser possível remover metas do usuário logado
- só deve ser possível remover metas do perfil ativo

### RF22 - Previsão de metas

O sistema deve calcular uma previsão para alcançar cada meta.

Critérios:

- a previsão deve usar o saldo mensal atual
- se o saldo mensal for positivo, o sistema calcula em quantos meses a meta pode ser atingida
- se o saldo mensal for zero ou negativo, a meta deve aparecer sem previsão
- o sistema deve mostrar o mês e ano estimado

### RF23 - Gráfico simples

O sistema deve exibir um gráfico simples na dashboard.

Critérios:

- mostrar renda
- mostrar gastos fixos
- mostrar gastos percentuais
- mostrar gastos variáveis
- mostrar saldo mensal
- o gráfico deve usar barras proporcionais aos valores

### RF24 - Histórico mensal real

O sistema deve permitir salvar um fechamento mensal.

Critérios:

- o usuário deve informar mês e ano
- o sistema deve salvar renda, gastos fixos, gastos percentuais, gastos variáveis e saldo
- o fechamento deve pertencer ao usuário logado
- o fechamento deve pertencer ao perfil ativo
- se já existir fechamento para o mesmo perfil e mês, o sistema deve atualizar o registro

### RF25 - Listagem de histórico mensal

O sistema deve listar os fechamentos mensais salvos.

Critérios:

- listar no máximo os 12 fechamentos mais recentes
- ordenar por mês mais recente primeiro
- mostrar entrada, gastos e saldo

### RF26 - Remoção de histórico mensal

O sistema deve permitir remover um fechamento mensal.

Critérios:

- só deve ser possível remover fechamentos do usuário logado
- só deve ser possível remover fechamentos do perfil ativo

## 7. Requisitos não funcionais

### RNF01 - Tecnologia principal

O sistema deve ser desenvolvido com Node.js e TypeScript.

### RNF02 - Servidor web

O sistema deve usar Express para criar o servidor web e as rotas.

### RNF03 - Banco de dados

O sistema deve persistir dados em SQLite.

Critérios:

- o banco principal deve ficar em `data/financemanager.sqlite`
- as sessões também devem ser salvas em SQLite
- a pasta `data/` não deve ser versionada

### RNF04 - Sessão

O sistema deve usar sessão no servidor.

Critérios:

- a sessão deve usar `express-session`
- o armazenamento da sessão deve usar `connect-sqlite3`
- o cookie deve usar `httpOnly`
- o cookie deve usar `sameSite: lax`
- o cookie deve usar `secure` quando `NODE_ENV` for `production`

### RNF05 - Segurança de senha

O sistema não deve salvar senha em texto puro.

Critério:

- usar `bcrypt` para gerar hash da senha

### RNF06 - Variáveis de ambiente

O sistema deve carregar configurações a partir de variáveis de ambiente.

Critérios:

- `SESSION_SECRET` deve ser obrigatória
- `DEFAULT_ADMIN_PASSWORD` pode ser usada para criar o usuário admin inicial
- `PORT` deve permitir trocar a porta do servidor
- o arquivo `.env` não deve ser versionado

### RNF07 - Validação de entrada

O sistema deve tratar entradas inválidas antes de calcular ou salvar dados.

Critérios:

- valores monetários inválidos devem virar zero
- valores monetários negativos devem virar zero
- percentuais inválidos devem virar zero
- percentuais acima de 100% devem ser limitados a 100%
- datas inválidas devem ser corrigidas para uma data permitida

### RNF08 - Proteção contra HTML indesejado

O sistema deve escapar textos exibidos na página.

Critério:

- dados textuais vindos do usuário devem passar por escape antes de aparecer no HTML

### RNF09 - Interface

O sistema deve ter interface em tema escuro e organizada em cards.

Critérios:

- a dashboard deve priorizar leitura rápida
- os principais dados devem aparecer em cards
- formulários devem ficar dentro do próprio painel
- a interface deve funcionar em telas menores com layout responsivo

### RNF10 - Execução local

O sistema deve funcionar localmente após instalar as dependências.

Critérios:

- `npm run dev` deve iniciar o projeto em desenvolvimento
- `npm run build` deve compilar o TypeScript
- `npm start` deve rodar a versão compilada

### RNF11 - Arquivos fora do Git

Arquivos sensíveis, gerados ou locais não devem ser versionados.

Critérios:

- não versionar `.env`
- não versionar `node_modules/`
- não versionar `dist/`
- não versionar `data/`
- não versionar bancos SQLite
- não versionar logs

## 8. Regras de negócio

### RN01 - Saldo mensal

O saldo mensal deve ser calculado com a fórmula:

```text
renda mensal - gastos fixos - gastos percentuais - gastos variáveis
```

### RN02 - Gasto percentual

Gastos percentuais devem ser calculados sobre a renda mensal do perfil ativo.

Exemplo:

```text
renda mensal: R$ 3000,00
percentual: 10%
valor calculado: R$ 300,00
```

### RN03 - Separação por perfil

Renda, gastos, metas e histórico devem ser separados por perfil financeiro.

### RN04 - Separação por usuário

Um usuário não deve editar, remover ou visualizar dados financeiros de outro
usuário.

### RN05 - Perfil padrão

Todo usuário deve ter pelo menos um perfil financeiro.

### RN06 - Previsão por data

A previsão financeira deve considerar a situação atual do perfil e projetar os
valores mês a mês até a data selecionada.

### RN07 - Previsão de metas

A previsão de metas deve considerar o saldo mensal atual.

Se o saldo mensal for menor ou igual a zero, não deve haver previsão de data para
a meta.

### RN08 - Histórico mensal

O histórico mensal deve ser um fechamento salvo pelo usuário.

Alterações posteriores em renda ou gastos não devem alterar automaticamente um
fechamento já salvo. Para atualizar um mês, o usuário deve salvar o fechamento
novamente.

## 9. Casos de uso

### CU01 - Criar conta

1. O visitante acessa a tela de cadastro.
2. Informa nome de usuário e senha.
3. O sistema valida os dados.
4. O sistema cria o usuário.
5. O sistema cria o perfil padrão.
6. O sistema inicia a sessão.
7. O usuário é redirecionado para a dashboard.

### CU02 - Fazer login

1. O visitante acessa a tela de login.
2. Informa nome de usuário e senha.
3. O sistema compara a senha com o hash salvo.
4. O sistema inicia a sessão.
5. O usuário é redirecionado para a dashboard.

### CU03 - Criar perfil financeiro

1. O usuário está logado.
2. Informa o nome do novo perfil.
3. O sistema cria o perfil para o usuário logado.
4. O sistema define o novo perfil como ativo.

### CU04 - Registrar renda e gastos

1. O usuário seleciona um perfil.
2. Informa a renda mensal.
3. Cadastra gastos fixos.
4. Cadastra gastos percentuais.
5. Cadastra gastos variáveis.
6. O sistema recalcula os totais da dashboard.

### CU05 - Criar meta financeira

1. O usuário informa nome e valor alvo da meta.
2. O sistema salva a meta no perfil ativo.
3. O sistema calcula a previsão com base no saldo mensal.
4. A meta aparece na dashboard.

### CU06 - Salvar fechamento mensal

1. O usuário seleciona mês e ano.
2. O sistema lê os valores atuais do perfil.
3. O sistema salva ou atualiza o fechamento mensal.
4. O fechamento aparece no histórico.

## 10. Critérios gerais de aceite

- o projeto compila com `npm run build`
- o usuário consegue criar conta
- o usuário consegue fazer login
- usuário sem login não acessa a dashboard
- o usuário consegue sair da conta
- todo usuário tem perfil padrão
- perfis separam os dados financeiros
- renda mensal altera os cálculos da dashboard
- gastos fixos entram no saldo mensal
- gastos percentuais são calculados sobre a renda
- gastos variáveis entram no saldo mensal
- metas exibem previsão quando há saldo positivo
- histórico mensal salva fechamento por perfil
- dados de um usuário não podem ser alterados por outro usuário
