import fs from "fs";
import path from "path";
import bcrypt from "bcrypt";
import express, { type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import connectSqlite3 from "connect-sqlite3";
import sqlite3 from "sqlite3";

declare module "express-session" {
  interface SessionData {
    user?: {
      id: number;
      username: string;
    };
  }
}

interface User {
  id: number;
  username: string;
  password_hash: string;
}

interface FinanceSettings {
  monthly_income_cents: number;
}

interface Expense {
  id: number;
  name: string;
  amount_cents: number;
}

interface DashboardSummary {
  selectedDate: Date;
  minDate: string;
  maxDate: string;
  monthLabel: string;
  monthsAhead: number;
  incomeCents: number;
  fixedTotalCents: number;
  percentageTotalCents: number;
  variableTotalCents: number;
  predictedBalanceCents: number;
  fixedExpenses: Expense[];
}

const app = express();
const SQLiteStore = connectSqlite3(session);
const PORT = Number(process.env.PORT ?? 3000);
const SESSION_SECRET =
  process.env.SESSION_SECRET ?? "dev-secret-change-before-production";
const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "financemanager.sqlite");

fs.mkdirSync(DATA_DIR, { recursive: true });
sqlite3.verbose();

const db = new sqlite3.Database(DB_PATH);

function run(sql: string, params: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (error) => (error ? reject(error) : resolve()));
  });
}

function get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) =>
      error ? reject(error) : resolve(row as T | undefined),
    );
  });
}

function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) =>
      error ? reject(error) : resolve(rows as T[]),
    );
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toInputDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addYears(date: Date, years: number): Date {
  const nextDate = new Date(date);
  nextDate.setFullYear(nextDate.getFullYear() + years);
  return nextDate;
}

function clampDate(dateValue: unknown): Date {
  const today = new Date();
  const minDate = new Date(toInputDate(today));
  const maxDate = addYears(minDate, 1);
  const requestedDate = new Date(String(dateValue ?? toInputDate(minDate)));

  if (Number.isNaN(requestedDate.getTime()) || requestedDate < minDate) {
    return minDate;
  }

  if (requestedDate > maxDate) {
    return maxDate;
  }

  return requestedDate;
}

function monthsBetween(startDate: Date, endDate: Date): number {
  return (
    (endDate.getFullYear() - startDate.getFullYear()) * 12 +
    endDate.getMonth() -
    startDate.getMonth()
  );
}

function parseCurrencyToCents(value: unknown): number {
  const rawValue = String(value ?? "")
    .trim()
    .replace(/[^\d.,]/g, "");
  const lastComma = rawValue.lastIndexOf(",");
  const lastDot = rawValue.lastIndexOf(".");
  let normalizedValue = rawValue;

  if (lastComma >= 0 && lastDot >= 0) {
    normalizedValue =
      lastComma > lastDot
        ? rawValue.replace(/\./g, "").replace(",", ".")
        : rawValue.replace(/,/g, "");
  } else if (lastComma >= 0) {
    normalizedValue = rawValue.replace(",", ".");
  }

  const amount = Number(normalizedValue);

  if (!Number.isFinite(amount) || amount < 0) {
    return 0;
  }

  return Math.round(amount * 100);
}

function money(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

async function getMonthlyIncomeCents(userId: number): Promise<number> {
  const settings = await get<FinanceSettings>(
    "SELECT monthly_income_cents FROM finance_settings WHERE user_id = ?",
    [userId],
  );

  return settings?.monthly_income_cents ?? 0;
}

async function getFixedExpenses(userId: number): Promise<Expense[]> {
  return all<Expense>(
    `
      SELECT id, name, amount_cents
      FROM expenses
      WHERE user_id = ? AND type = 'fixed'
      ORDER BY name
    `,
    [userId],
  );
}

async function buildDashboardSummary(
  userId: number,
  dateValue: unknown,
): Promise<DashboardSummary> {
  const today = new Date();
  const minDate = new Date(toInputDate(today));
  const maxDate = addYears(minDate, 1);
  const selectedDate = clampDate(dateValue);
  const incomeCents = await getMonthlyIncomeCents(userId);
  const fixedExpenses = await getFixedExpenses(userId);
  const fixedTotalCents = fixedExpenses.reduce(
    (total, expense) => total + expense.amount_cents,
    0,
  );
  const percentageTotalCents = 0;
  const variableTotalCents = 0;

  return {
    selectedDate,
    minDate: toInputDate(minDate),
    maxDate: toInputDate(maxDate),
    monthLabel: selectedDate.toLocaleDateString("pt-BR", {
      month: "long",
      year: "numeric",
    }),
    monthsAhead: Math.max(0, monthsBetween(minDate, selectedDate)),
    incomeCents,
    fixedTotalCents,
    percentageTotalCents,
    variableTotalCents,
    predictedBalanceCents:
      incomeCents - fixedTotalCents - percentageTotalCents - variableTotalCents,
    fixedExpenses,
  };
}

async function setupDatabase(): Promise<void> {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS finance_settings (
      user_id INTEGER PRIMARY KEY,
      monthly_income_cents INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  const admin = await get<User>("SELECT * FROM users WHERE username = ?", [
    "admin",
  ]);

  if (!admin) {
    const passwordHash = await bcrypt.hash("senhaqtuvaiusar", 12);
    await run("INSERT INTO users (username, password_hash) VALUES (?, ?)", [
      "admin",
      passwordHash,
    ]);
  }
}

function requireLogin(request: Request, response: Response, next: NextFunction): void {
  if (!request.session.user) {
    response.redirect("/login");
    return;
  }

  next();
}

function loginPage(error = "", username = ""): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, sans-serif; background: #121212; color: white; }
    main { width: min(400px, calc(100vw - 32px)); padding: 32px; background: #1e1e1e; border-radius: 8px; }
    label { display: block; margin: 16px 0 8px; }
    input, button { width: 100%; padding: 12px; border-radius: 6px; border: 0; box-sizing: border-box; }
    input { background: #2c2c2c; color: white; }
    button { margin-top: 18px; background: #707070; color: white; cursor: pointer; }
    .error { padding: 12px; background: #5f2424; border-radius: 6px; }
  </style>
</head>
<body>
  <main>
    <h1>Login</h1>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    <form method="POST" action="/login">
      <label for="username">Usuario</label>
      <input id="username" name="username" value="${escapeHtml(username)}" required>
      <label for="password">Senha</label>
      <input id="password" name="password" type="password" required>
      <button type="submit">Entrar</button>
    </form>
  </main>
</body>
</html>`;
}

function dashboardPage(username: string, summary: DashboardSummary): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Finance Manager</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #121212; color: white; }
    header { display: flex; justify-content: space-between; align-items: center; padding: 14px 24px; background: #000; }
    button { padding: 8px 14px; border: 0; border-radius: 6px; background: #707070; color: white; cursor: pointer; }
    main { width: min(1100px, calc(100vw - 32px)); margin: 0 auto; padding: 32px 0; }
    .toolbar { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
    .field label { display: block; margin-bottom: 8px; color: #cfcfcf; }
    input { padding: 10px; border: 0; border-radius: 6px; background: #2c2c2c; color: white; }
    .income-form { display: flex; align-items: end; gap: 10px; margin-bottom: 24px; }
    .income-form input { width: 180px; }
    .panel { margin-top: 24px; padding: 20px; background: #1b1b1b; border: 1px solid #333; border-radius: 8px; }
    .expense-form { display: grid; grid-template-columns: 1fr 180px auto; gap: 10px; align-items: end; }
    .expense-list { width: 100%; margin-top: 16px; border-collapse: collapse; }
    .expense-list th, .expense-list td { padding: 10px; border-top: 1px solid #333; text-align: left; }
    .expense-list form { display: flex; gap: 8px; align-items: center; }
    .expense-list input { width: 100%; }
    .expense-list .amount-input { width: 140px; }
    .actions { width: 190px; }
    .grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
    .card { padding: 18px; background: #1f1f1f; border: 1px solid #333; border-radius: 8px; }
    .label { margin: 0 0 8px; color: #cfcfcf; font-size: 0.9rem; }
    .value { margin: 0; font-size: 1.35rem; font-weight: bold; }
    .note { color: #cfcfcf; }
    @media (max-width: 850px) {
      header, .toolbar { align-items: flex-start; flex-direction: column; }
      .income-form { align-items: stretch; flex-direction: column; }
      .income-form input { width: 100%; }
      .expense-form { grid-template-columns: 1fr; }
      .expense-list, .expense-list tbody, .expense-list tr, .expense-list td { display: block; width: 100%; }
      .expense-list thead { display: none; }
      .expense-list form { align-items: stretch; flex-direction: column; }
      .expense-list .amount-input { width: 100%; }
      .actions { width: auto; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <strong>Finance Manager</strong>
    <form method="POST" action="/logout">
      <span>${escapeHtml(username)}</span>
      <button type="submit">Sair</button>
    </form>
  </header>
  <main>
    <section class="toolbar">
      <div>
        <h1>Resumo financeiro</h1>
        <p class="note">Previsao para ${escapeHtml(summary.monthLabel)} (${summary.monthsAhead} mes(es) a frente).</p>
      </div>
      <form method="GET" action="/dashboard">
        <div class="field">
          <label for="date">Selecionar data</label>
          <input
            id="date"
            name="date"
            type="date"
            min="${summary.minDate}"
            max="${summary.maxDate}"
            value="${toInputDate(summary.selectedDate)}"
            onchange="this.form.submit()"
          >
        </div>
      </form>
    </section>

    <form class="income-form" method="POST" action="/income">
      <div class="field">
        <label for="monthlyIncome">Renda mensal total</label>
        <input
          id="monthlyIncome"
          name="monthlyIncome"
          type="number"
          min="0"
          step="0.01"
          value="${(summary.incomeCents / 100).toFixed(2)}"
          required
        >
      </div>
      <button type="submit">Salvar renda</button>
    </form>

    <section class="grid" aria-label="Previsao financeira">
      <article class="card">
        <p class="label">Renda total</p>
        <p class="value">${money(summary.incomeCents)}</p>
      </article>
      <article class="card">
        <p class="label">Gastos fixos</p>
        <p class="value">${money(summary.fixedTotalCents)}</p>
      </article>
      <article class="card">
        <p class="label">Gastos percentuais</p>
        <p class="value">${money(summary.percentageTotalCents)}</p>
      </article>
      <article class="card">
        <p class="label">Gastos variaveis</p>
        <p class="value">${money(summary.variableTotalCents)}</p>
      </article>
      <article class="card">
        <p class="label">Saldo previsto</p>
        <p class="value">${money(summary.predictedBalanceCents)}</p>
      </article>
    </section>

    <section class="panel">
      <h2>Gastos fixos</h2>
      <form class="expense-form" method="POST" action="/expenses/fixed">
        <div class="field">
          <label for="fixedName">Nome</label>
          <input id="fixedName" name="name" placeholder="Ex: aluguel" required>
        </div>
        <div class="field">
          <label for="fixedAmount">Valor mensal</label>
          <input id="fixedAmount" name="amount" type="number" min="0" step="0.01" required>
        </div>
        <button type="submit">Adicionar</button>
      </form>

      <table class="expense-list">
        <thead>
          <tr>
            <th>Gasto</th>
            <th>Valor</th>
            <th class="actions">Acoes</th>
          </tr>
        </thead>
        <tbody>
          ${
            summary.fixedExpenses.length
              ? summary.fixedExpenses
                  .map(
                    (expense) => `
                      <tr>
                        <td colspan="3">
                          <form method="POST" action="/expenses/${expense.id}/fixed">
                            <input name="name" value="${escapeHtml(expense.name)}" required>
                            <input class="amount-input" name="amount" type="number" min="0" step="0.01" value="${(expense.amount_cents / 100).toFixed(2)}" required>
                            <button type="submit">Salvar</button>
                            <button type="submit" formaction="/expenses/${expense.id}/delete">Remover</button>
                          </form>
                        </td>
                      </tr>
                    `,
                  )
                  .join("")
              : `<tr><td colspan="3">Nenhum gasto fixo cadastrado.</td></tr>`
          }
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    store: new SQLiteStore({ db: "sessions.sqlite", dir: DATA_DIR }) as unknown as session.Store,
    name: "financemanager.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  }),
);

app.get("/", (request, response) => {
  response.redirect(request.session.user ? "/dashboard" : "/login");
});

app.get("/login", (request, response) => {
  if (request.session.user) {
    response.redirect("/dashboard");
    return;
  }

  response.send(loginPage());
});

app.post("/login", async (request, response, next) => {
  try {
    const username = String(request.body.username ?? "").trim();
    const password = String(request.body.password ?? "");
    const user = await get<User>("SELECT * FROM users WHERE username = ?", [
      username,
    ]);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      response.status(401).send(loginPage("Usuario ou senha invalidos.", username));
      return;
    }

    request.session.regenerate((error) => {
      if (error) {
        next(error);
        return;
      }

      request.session.user = { id: user.id, username: user.username };
      response.redirect("/dashboard");
    });
  } catch (error) {
    next(error);
  }
});

app.get("/dashboard", requireLogin, async (request, response, next) => {
  try {
    const user = request.session.user;

    if (!user) {
      response.redirect("/login");
      return;
    }

    const summary = await buildDashboardSummary(user.id, request.query.date);
    response.send(dashboardPage(user.username, summary));
  } catch (error) {
    next(error);
  }
});

app.post("/income", requireLogin, async (request, response, next) => {
  try {
    const user = request.session.user;

    if (!user) {
      response.redirect("/login");
      return;
    }

    const monthlyIncomeCents = parseCurrencyToCents(request.body.monthlyIncome);

    await run(
      `
        INSERT INTO finance_settings (user_id, monthly_income_cents)
        VALUES (?, ?)
        ON CONFLICT(user_id)
        DO UPDATE SET monthly_income_cents = excluded.monthly_income_cents
      `,
      [user.id, monthlyIncomeCents],
    );

    response.redirect("/dashboard");
  } catch (error) {
    next(error);
  }
});

app.post("/expenses/fixed", requireLogin, async (request, response, next) => {
  try {
    const user = request.session.user;

    if (!user) {
      response.redirect("/login");
      return;
    }

    const name = String(request.body.name ?? "").trim();
    const amountCents = parseCurrencyToCents(request.body.amount);

    if (name) {
      await run(
        `
          INSERT INTO expenses (user_id, type, name, amount_cents)
          VALUES (?, 'fixed', ?, ?)
        `,
        [user.id, name, amountCents],
      );
    }

    response.redirect("/dashboard");
  } catch (error) {
    next(error);
  }
});

app.post("/expenses/:id/fixed", requireLogin, async (request, response, next) => {
  try {
    const user = request.session.user;

    if (!user) {
      response.redirect("/login");
      return;
    }

    const expenseId = Number(request.params.id);
    const name = String(request.body.name ?? "").trim();
    const amountCents = parseCurrencyToCents(request.body.amount);

    if (Number.isInteger(expenseId) && name) {
      await run(
        `
          UPDATE expenses
          SET name = ?, amount_cents = ?
          WHERE id = ? AND user_id = ? AND type = 'fixed'
        `,
        [name, amountCents, expenseId, user.id],
      );
    }

    response.redirect("/dashboard");
  } catch (error) {
    next(error);
  }
});

app.post("/expenses/:id/delete", requireLogin, async (request, response, next) => {
  try {
    const user = request.session.user;

    if (!user) {
      response.redirect("/login");
      return;
    }

    const expenseId = Number(request.params.id);

    if (Number.isInteger(expenseId)) {
      await run("DELETE FROM expenses WHERE id = ? AND user_id = ?", [
        expenseId,
        user.id,
      ]);
    }

    response.redirect("/dashboard");
  } catch (error) {
    next(error);
  }
});

app.post("/logout", requireLogin, (request, response, next) => {
  request.session.destroy((error) => {
    if (error) {
      next(error);
      return;
    }

    response.clearCookie("financemanager.sid");
    response.redirect("/login");
  });
});

setupDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log("Default login: admin / senhaqtuvaiusar");
  });
});
