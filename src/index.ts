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

interface PercentageExpense {
  id: number;
  name: string;
  percentage_basis_points: number;
}

interface ProjectionMonth {
  label: string;
  incomeCents: number;
  fixedTotalCents: number;
  percentageTotalCents: number;
  variableTotalCents: number;
  balanceCents: number;
  accumulatedBalanceCents: number;
  differenceCents: number | null;
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
  accumulatedBalanceCents: number;
  fixedExpenses: Expense[];
  percentageExpenses: PercentageExpense[];
  variableExpenses: Expense[];
  projectionMonths: ProjectionMonth[];
}

function loadEnvFile(): void {
  const envPath = path.join(__dirname, "..", ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = trimmedLine.slice(separatorIndex + 1).trim();

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const app = express();
const SQLiteStore = connectSqlite3(session);
const PORT = Number(process.env.PORT ?? 3000);
const SESSION_SECRET = process.env.SESSION_SECRET;
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD;
const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "financemanager.sqlite");

if (!SESSION_SECRET) {
  throw new Error("Defina SESSION_SECRET antes de iniciar o servidor.");
}

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

async function hasColumn(tableName: string, columnName: string): Promise<boolean> {
  const columns = await all<{ name: string }>(`PRAGMA table_info(${tableName})`);
  return columns.some((column) => column.name === columnName);
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

function addMonths(date: Date, months: number): Date {
  const nextDate = new Date(date);
  nextDate.setMonth(nextDate.getMonth() + months);
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

function parsePercentageToBasisPoints(value: unknown): number {
  const normalizedValue = String(value ?? "")
    .trim()
    .replace(",", ".")
    .replace(/[^\d.]/g, "");
  const percentage = Number(normalizedValue);

  if (!Number.isFinite(percentage) || percentage < 0) {
    return 0;
  }

  return Math.round(percentage * 100);
}

function money(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function percentageLabel(basisPoints: number): string {
  return (basisPoints / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
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

async function getPercentageExpenses(
  userId: number,
): Promise<PercentageExpense[]> {
  return all<PercentageExpense>(
    `
      SELECT id, name, percentage_basis_points
      FROM expenses
      WHERE user_id = ? AND type = 'percentage'
      ORDER BY name
    `,
    [userId],
  );
}

async function getVariableExpenses(userId: number): Promise<Expense[]> {
  return all<Expense>(
    `
      SELECT id, name, amount_cents
      FROM expenses
      WHERE user_id = ? AND type = 'variable'
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
  const percentageExpenses = await getPercentageExpenses(userId);
  const variableExpenses = await getVariableExpenses(userId);
  const fixedTotalCents = fixedExpenses.reduce(
    (total, expense) => total + expense.amount_cents,
    0,
  );
  const percentageTotalCents = percentageExpenses.reduce(
    (total, expense) =>
      total + Math.round((incomeCents * expense.percentage_basis_points) / 10000),
    0,
  );
  const variableTotalCents = variableExpenses.reduce(
    (total, expense) => total + expense.amount_cents,
    0,
  );
  const monthlyBalanceCents =
    incomeCents - fixedTotalCents - percentageTotalCents - variableTotalCents;
  const monthsAhead = Math.max(0, monthsBetween(minDate, selectedDate));
  const projectionMonths: ProjectionMonth[] = [];

  for (let monthIndex = 0; monthIndex <= monthsAhead; monthIndex += 1) {
    const accumulatedBalanceCents = monthlyBalanceCents * (monthIndex + 1);

    projectionMonths.push({
      label: monthLabel(addMonths(minDate, monthIndex)),
      incomeCents,
      fixedTotalCents,
      percentageTotalCents,
      variableTotalCents,
      balanceCents: monthlyBalanceCents,
      accumulatedBalanceCents,
      differenceCents: monthIndex === 0 ? null : 0,
    });
  }

  return {
    selectedDate,
    minDate: toInputDate(minDate),
    maxDate: toInputDate(maxDate),
    monthLabel: monthLabel(selectedDate),
    monthsAhead,
    incomeCents,
    fixedTotalCents,
    percentageTotalCents,
    variableTotalCents,
    predictedBalanceCents: monthlyBalanceCents,
    accumulatedBalanceCents: projectionMonths.at(-1)?.accumulatedBalanceCents ?? 0,
    fixedExpenses,
    percentageExpenses,
    variableExpenses,
    projectionMonths,
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
      percentage_basis_points INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  if (!(await hasColumn("expenses", "percentage_basis_points"))) {
    await run(
      "ALTER TABLE expenses ADD COLUMN percentage_basis_points INTEGER NOT NULL DEFAULT 0",
    );
  }

  const admin = await get<User>("SELECT * FROM users WHERE username = ?", [
    "admin",
  ]);

  if (!admin && DEFAULT_ADMIN_PASSWORD) {
    const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 12);
    await run("INSERT INTO users (username, password_hash) VALUES (?, ?)", [
      "admin",
      passwordHash,
    ]);
  } else if (!admin) {
    console.warn(
      "Nenhum usuario admin criado. Defina DEFAULT_ADMIN_PASSWORD no ambiente.",
    );
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
  const fixedRows = summary.fixedExpenses.length
    ? summary.fixedExpenses
        .map(
          (expense) => `
            <form class="item-row" method="POST" action="/expenses/${expense.id}/fixed">
              <input name="name" value="${escapeHtml(expense.name)}" required>
              <input class="money-input" name="amount" type="number" min="0" step="0.01" value="${(expense.amount_cents / 100).toFixed(2)}" required>
              <button type="submit">Salvar</button>
              <button type="submit" formaction="/expenses/${expense.id}/delete">Remover</button>
            </form>
          `,
        )
        .join("")
    : `<p class="empty">Nenhum gasto fixo cadastrado.</p>`;

  const percentageRows = summary.percentageExpenses.length
    ? summary.percentageExpenses
        .map((expense) => {
          const calculatedValue = Math.round(
            (summary.incomeCents * expense.percentage_basis_points) / 10000,
          );

          return `
            <form class="item-row percentage-row" method="POST" action="/expenses/${expense.id}/percentage">
              <input name="name" value="${escapeHtml(expense.name)}" required>
              <input class="percent-input" name="percentage" type="number" min="0" max="100" step="0.01" value="${(expense.percentage_basis_points / 100).toFixed(2)}" required>
              <span>${percentageLabel(expense.percentage_basis_points)}% = ${money(calculatedValue)}</span>
              <button type="submit">Salvar</button>
              <button type="submit" formaction="/expenses/${expense.id}/delete">Remover</button>
            </form>
          `;
        })
        .join("")
    : `<p class="empty">Nenhum gasto percentual cadastrado.</p>`;

  const variableRows = summary.variableExpenses.length
    ? summary.variableExpenses
        .map(
          (expense) => `
            <form class="item-row" method="POST" action="/expenses/${expense.id}/variable">
              <input name="name" value="${escapeHtml(expense.name)}" required>
              <input class="money-input" name="amount" type="number" min="0" step="0.01" value="${(expense.amount_cents / 100).toFixed(2)}" required>
              <button type="submit">Salvar</button>
              <button type="submit" formaction="/expenses/${expense.id}/delete">Remover</button>
            </form>
          `,
        )
        .join("")
    : `<p class="empty">Nenhum gasto variavel cadastrado.</p>`;

  const projectionRows = summary.projectionMonths
    .map(
      (month) => `
        <tr>
          <td>${escapeHtml(month.label)}</td>
          <td>${money(month.incomeCents)}</td>
          <td>${money(month.fixedTotalCents)}</td>
          <td>${money(month.percentageTotalCents)}</td>
          <td>${money(month.variableTotalCents)}</td>
          <td>${money(month.balanceCents)}</td>
          <td>${money(month.accumulatedBalanceCents)}</td>
          <td>${month.differenceCents === null ? "-" : money(month.differenceCents)}</td>
        </tr>
      `,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Finance Manager</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, sans-serif; background: #0f0f10; color: white; }
    button, input, summary { font: inherit; }
    button { padding: 8px 10px; border: 0; border-radius: 6px; background: #747474; color: white; cursor: pointer; white-space: nowrap; }
    button:hover, button:focus { background: #8a8a8a; }
    input { min-width: 0; padding: 9px 10px; border: 1px solid #373737; border-radius: 6px; background: #202124; color: white; }
    .topbar { min-height: 72px; display: grid; grid-template-columns: 1fr auto auto; gap: 18px; align-items: center; padding: 14px 22px; background: #000; border-bottom: 1px solid #252525; }
    .brand { font-size: 1.45rem; font-weight: 700; }
    .profile { padding: 9px 14px; border: 1px solid #555; border-radius: 6px; background: #111; }
    .user-box { display: flex; gap: 12px; align-items: center; color: #e8e8e8; }
    .user-box form { margin: 0; }
    main { width: min(1440px, calc(100vw - 28px)); margin: 0 auto; padding: 18px 0 28px; }
    .dashboard-grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 14px; align-items: start; }
    .card { min-height: 230px; padding: 16px; background: #18191b; border: 1px solid #303236; border-radius: 8px; box-shadow: 0 12px 28px rgba(0, 0, 0, 0.22); }
    .card h2 { margin: 0; font-size: 1rem; color: #d7d7d7; }
    .card-head { display: flex; justify-content: space-between; gap: 12px; align-items: start; margin-bottom: 12px; }
    .metric { margin: 6px 0 14px; font-size: 1.65rem; font-weight: 700; }
    .small { color: #bdbdbd; font-size: 0.9rem; }
    .income-card { grid-column: span 3; }
    .fixed-card { grid-column: span 3; }
    .percentage-card { grid-column: span 3; }
    .variable-card { grid-column: span 3; }
    .balance-card { grid-column: span 4; }
    .forecast-card { grid-column: span 8; }
    .item-list { display: grid; gap: 8px; max-height: 210px; overflow-y: auto; overflow-x: hidden; padding-right: 4px; }
    .item-row { display: grid; grid-template-columns: minmax(0, 1fr) 96px; gap: 8px; align-items: center; padding: 8px; background: #111214; border: 1px solid #292b2f; border-radius: 7px; }
    .item-row input { width: 100%; }
    .item-row button { width: 100%; padding: 7px 8px; font-size: 0.84rem; }
    .item-row button:first-of-type { grid-column: 1; }
    .item-row button:last-of-type { grid-column: 2; }
    .percentage-row { grid-template-columns: minmax(0, 1fr) 84px; }
    .percentage-row span { grid-column: 1 / -1; color: #cfcfcf; font-size: 0.86rem; }
    .money-input, .percent-input { width: 100%; }
    .empty { margin: 8px 0 0; color: #aaa; }
    details { margin-top: 10px; }
    summary { display: inline-flex; padding: 7px 10px; border-radius: 6px; background: #2b2d30; cursor: pointer; color: #f2f2f2; }
    .compact-form { display: grid; grid-template-columns: minmax(120px, 1fr) 130px auto; gap: 8px; align-items: end; margin-top: 10px; padding: 10px; background: #111214; border: 1px solid #292b2f; border-radius: 7px; }
    .field label { display: block; margin-bottom: 6px; color: #cfcfcf; font-size: 0.82rem; }
    .income-form { grid-template-columns: 1fr auto; }
    .balance-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .balance-box { padding: 12px; background: #111214; border: 1px solid #292b2f; border-radius: 7px; }
    .balance-box p { margin: 0; }
    .balance-box strong { display: block; margin-top: 5px; font-size: 1.15rem; }
    .date-form { display: grid; grid-template-columns: minmax(150px, 1fr) auto; gap: 8px; align-items: end; margin-bottom: 12px; }
    .projection-wrap { max-height: 250px; overflow: auto; border: 1px solid #292b2f; border-radius: 7px; }
    .projection-table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
    .projection-table th, .projection-table td { padding: 9px; border-top: 1px solid #2c2e32; text-align: right; white-space: nowrap; }
    .projection-table th:first-child, .projection-table td:first-child { text-align: left; }
    .projection-table thead th { position: sticky; top: 0; background: #202124; z-index: 1; }
    @media (max-width: 1180px) {
      .income-card, .fixed-card, .percentage-card, .variable-card { grid-column: span 6; }
      .balance-card, .forecast-card { grid-column: span 12; }
    }
    @media (max-width: 760px) {
      .topbar { grid-template-columns: 1fr; align-items: start; }
      .user-box { flex-wrap: wrap; }
      .dashboard-grid { grid-template-columns: 1fr; }
      .income-card, .fixed-card, .percentage-card, .variable-card, .balance-card, .forecast-card { grid-column: span 1; }
      .compact-form, .income-form, .date-form, .item-row, .percentage-row { grid-template-columns: 1fr; }
      .item-row button:first-of-type, .item-row button:last-of-type, .percentage-row span { grid-column: auto; }
      .balance-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">Finance Manager</div>
    <div class="profile">perfil: CASA</div>
    <div class="user-box">
      <span>usuario: ${escapeHtml(username)}</span>
      <form method="POST" action="/logout">
      <button type="submit">Sair</button>
    </form>
    </div>
  </header>
  <main>
    <section class="dashboard-grid" aria-label="Dashboard financeira">
      <article class="card income-card">
        <div class="card-head">
          <h2>Entrada total</h2>
        </div>
        <p class="metric">${money(summary.incomeCents)}</p>
        <form class="compact-form income-form" method="POST" action="/income">
          <div class="field">
            <label for="monthlyIncome">Renda mensal total</label>
            <input id="monthlyIncome" name="monthlyIncome" type="number" min="0" step="0.01" value="${(summary.incomeCents / 100).toFixed(2)}" required>
          </div>
          <button type="submit">Salvar</button>
        </form>
      </article>

      <article class="card fixed-card">
        <div class="card-head">
          <h2>Gastos fixos</h2>
          <strong>${money(summary.fixedTotalCents)}</strong>
        </div>
        <div class="item-list">${fixedRows}</div>
        <details>
          <summary>Adicionar</summary>
          <form class="compact-form" method="POST" action="/expenses/fixed">
            <div class="field">
              <label for="fixedName">Nome</label>
              <input id="fixedName" name="name" placeholder="Ex: aluguel" required>
            </div>
            <div class="field">
              <label for="fixedAmount">Valor</label>
              <input id="fixedAmount" name="amount" type="number" min="0" step="0.01" required>
            </div>
            <button type="submit">Adicionar</button>
          </form>
        </details>
      </article>

      <article class="card percentage-card">
        <div class="card-head">
          <h2>Gastos percentuais</h2>
          <strong>${money(summary.percentageTotalCents)}</strong>
        </div>
        <div class="item-list">${percentageRows}</div>
        <details>
          <summary>Adicionar</summary>
          <form class="compact-form" method="POST" action="/expenses/percentage">
            <div class="field">
              <label for="percentageName">Nome</label>
              <input id="percentageName" name="name" placeholder="Ex: reserva" required>
            </div>
            <div class="field">
              <label for="percentageValue">Percentual</label>
              <input id="percentageValue" name="percentage" type="number" min="0" max="100" step="0.01" required>
            </div>
            <button type="submit">Adicionar</button>
          </form>
        </details>
      </article>

      <article class="card variable-card">
        <div class="card-head">
          <h2>Gastos variaveis</h2>
          <strong>${money(summary.variableTotalCents)}</strong>
        </div>
        <div class="item-list">${variableRows}</div>
        <details>
          <summary>Adicionar</summary>
          <form class="compact-form" method="POST" action="/expenses/variable">
            <div class="field">
              <label for="variableName">Nome</label>
              <input id="variableName" name="name" placeholder="Ex: mercado" required>
            </div>
            <div class="field">
              <label for="variableAmount">Valor atual</label>
              <input id="variableAmount" name="amount" type="number" min="0" step="0.01" required>
            </div>
            <button type="submit">Adicionar</button>
          </form>
        </details>
        <p class="small">O ultimo valor salvo vale para os proximos meses.</p>
      </article>

      <article class="card balance-card">
        <div class="card-head">
          <h2>Balanca / resumo</h2>
          <span class="small">${escapeHtml(summary.monthLabel)}</span>
        </div>
        <div class="balance-grid">
          <div class="balance-box">
            <p>Saldo mensal</p>
            <strong>${money(summary.predictedBalanceCents)}</strong>
          </div>
          <div class="balance-box">
            <p>Saldo acumulado</p>
            <strong>${money(summary.accumulatedBalanceCents)}</strong>
          </div>
          <div class="balance-box">
            <p>Total de gastos</p>
            <strong>${money(summary.fixedTotalCents + summary.percentageTotalCents + summary.variableTotalCents)}</strong>
          </div>
          <div class="balance-box">
            <p>Periodo</p>
            <strong>${summary.monthsAhead} mes(es)</strong>
          </div>
        </div>
      </article>

      <article class="card forecast-card">
        <div class="card-head">
          <h2>Previsao por data</h2>
          <span class="small">ate ${escapeHtml(summary.monthLabel)}</span>
        </div>
        <form class="date-form" method="GET" action="/dashboard">
          <div class="field">
            <label for="date">Selecionar data</label>
            <input id="date" name="date" type="date" min="${summary.minDate}" max="${summary.maxDate}" value="${toInputDate(summary.selectedDate)}" onchange="this.form.submit()">
          </div>
          <button type="submit">Ver</button>
        </form>
        <div class="projection-wrap">
          <table class="projection-table">
            <thead>
              <tr>
                <th>Mes</th>
                <th>Renda</th>
                <th>Fixos</th>
                <th>Percentuais</th>
                <th>Variaveis</th>
                <th>Saldo</th>
                <th>Acumulado</th>
                <th>Diferenca</th>
              </tr>
            </thead>
            <tbody>${projectionRows}</tbody>
          </table>
        </div>
      </article>
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

app.post("/expenses/percentage", requireLogin, async (request, response, next) => {
  try {
    const user = request.session.user;

    if (!user) {
      response.redirect("/login");
      return;
    }

    const name = String(request.body.name ?? "").trim();
    const percentageBasisPoints = parsePercentageToBasisPoints(
      request.body.percentage,
    );

    if (name) {
      await run(
        `
          INSERT INTO expenses (
            user_id,
            type,
            name,
            amount_cents,
            percentage_basis_points
          )
          VALUES (?, 'percentage', ?, 0, ?)
        `,
        [user.id, name, percentageBasisPoints],
      );
    }

    response.redirect("/dashboard");
  } catch (error) {
    next(error);
  }
});

app.post(
  "/expenses/:id/percentage",
  requireLogin,
  async (request, response, next) => {
    try {
      const user = request.session.user;

      if (!user) {
        response.redirect("/login");
        return;
      }

      const expenseId = Number(request.params.id);
      const name = String(request.body.name ?? "").trim();
      const percentageBasisPoints = parsePercentageToBasisPoints(
        request.body.percentage,
      );

      if (Number.isInteger(expenseId) && name) {
        await run(
          `
            UPDATE expenses
            SET name = ?, percentage_basis_points = ?
            WHERE id = ? AND user_id = ? AND type = 'percentage'
          `,
          [name, percentageBasisPoints, expenseId, user.id],
        );
      }

      response.redirect("/dashboard");
    } catch (error) {
      next(error);
    }
  },
);

app.post("/expenses/variable", requireLogin, async (request, response, next) => {
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
          VALUES (?, 'variable', ?, ?)
        `,
        [user.id, name, amountCents],
      );
    }

    response.redirect("/dashboard");
  } catch (error) {
    next(error);
  }
});

app.post(
  "/expenses/:id/variable",
  requireLogin,
  async (request, response, next) => {
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
            WHERE id = ? AND user_id = ? AND type = 'variable'
          `,
          [name, amountCents, expenseId, user.id],
        );
      }

      response.redirect("/dashboard");
    } catch (error) {
      next(error);
    }
  },
);

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
  });
});
