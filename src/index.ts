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
    activeProfileId?: number;
  }
}

interface User {
  id: number;
  username: string;
  password_hash: string;
}

interface FinanceProfile {
  id: number;
  user_id: number;
  name: string;
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

interface FinancialGoal {
  id: number;
  name: string;
  target_cents: number;
}

interface GoalProgress extends FinancialGoal {
  forecastLabel: string;
  monthsNeeded: number | null;
  progressPercent: number;
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
  profiles: FinanceProfile[];
  activeProfile: FinanceProfile;
  selectedDate: Date;
  minDate: string;
  maxDate: string;
  monthLabel: string;
  monthsAhead: number;
  incomeCents: number;
  fixedTotalCents: number;
  percentageTotalCents: number;
  variableTotalCents: number;
  totalExpensesCents: number;
  predictedBalanceCents: number;
  accumulatedBalanceCents: number;
  fixedExpenses: Expense[];
  percentageExpenses: PercentageExpense[];
  variableExpenses: Expense[];
  goals: GoalProgress[];
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
const DEFAULT_PROFILE_NAME = "PADRAO";

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

function runWithResult(
  sql: string,
  params: unknown[] = [],
): Promise<{ lastID: number; changes: number }> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }

      resolve({ lastID: this.lastID, changes: this.changes });
    });
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

async function hasTable(tableName: string): Promise<boolean> {
  const table = await get<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName],
  );

  return Boolean(table);
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
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function parseInputDate(value: unknown): Date | null {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));

  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return null;
  }

  return date;
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

function todayAtMidnight(): Date {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

function clampDate(dateValue: unknown): Date {
  const minDate = todayAtMidnight();
  const maxDate = addYears(minDate, 1);
  const requestedDate = parseInputDate(dateValue) ?? minDate;

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

  return Math.min(Math.round(percentage * 100), 10000);
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

function normalizeName(value: unknown, maxLength = 60): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

async function createDefaultProfile(userId: number): Promise<FinanceProfile> {
  await run(
    `
      INSERT OR IGNORE INTO profiles (user_id, name)
      VALUES (?, ?)
    `,
    [userId, DEFAULT_PROFILE_NAME],
  );

  const profile = await get<FinanceProfile>(
    "SELECT id, user_id, name FROM profiles WHERE user_id = ? AND name = ?",
    [userId, DEFAULT_PROFILE_NAME],
  );

  if (!profile) {
    throw new Error("Nao foi possivel criar o perfil padrao.");
  }

  return profile;
}

async function getProfiles(userId: number): Promise<FinanceProfile[]> {
  const profiles = await all<FinanceProfile>(
    `
      SELECT id, user_id, name
      FROM profiles
      WHERE user_id = ?
      ORDER BY id
    `,
    [userId],
  );

  if (profiles.length > 0) {
    return profiles;
  }

  return [await createDefaultProfile(userId)];
}

async function getProfileContext(
  userId: number,
  activeProfileId?: number,
): Promise<{ profiles: FinanceProfile[]; activeProfile: FinanceProfile }> {
  const profiles = await getProfiles(userId);
  const activeProfile =
    profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];

  return { profiles, activeProfile };
}

async function getMonthlyIncomeCents(profileId: number): Promise<number> {
  const settings = await get<FinanceSettings>(
    "SELECT monthly_income_cents FROM profile_settings WHERE profile_id = ?",
    [profileId],
  );

  return settings?.monthly_income_cents ?? 0;
}

async function getFixedExpenses(
  userId: number,
  profileId: number,
): Promise<Expense[]> {
  return all<Expense>(
    `
      SELECT id, name, amount_cents
      FROM expenses
      WHERE user_id = ? AND profile_id = ? AND type = 'fixed'
      ORDER BY name
    `,
    [userId, profileId],
  );
}

async function getPercentageExpenses(
  userId: number,
  profileId: number,
): Promise<PercentageExpense[]> {
  return all<PercentageExpense>(
    `
      SELECT id, name, percentage_basis_points
      FROM expenses
      WHERE user_id = ? AND profile_id = ? AND type = 'percentage'
      ORDER BY name
    `,
    [userId, profileId],
  );
}

async function getVariableExpenses(
  userId: number,
  profileId: number,
): Promise<Expense[]> {
  return all<Expense>(
    `
      SELECT id, name, amount_cents
      FROM expenses
      WHERE user_id = ? AND profile_id = ? AND type = 'variable'
      ORDER BY name
    `,
    [userId, profileId],
  );
}

async function getFinancialGoals(
  userId: number,
  profileId: number,
): Promise<FinancialGoal[]> {
  return all<FinancialGoal>(
    `
      SELECT id, name, target_cents
      FROM financial_goals
      WHERE user_id = ? AND profile_id = ?
      ORDER BY id DESC
    `,
    [userId, profileId],
  );
}

function buildGoalProgress(
  goals: FinancialGoal[],
  monthlyBalanceCents: number,
  accumulatedBalanceCents: number,
): GoalProgress[] {
  const minDate = todayAtMidnight();

  return goals.map((goal) => {
    if (monthlyBalanceCents <= 0 || goal.target_cents <= 0) {
      return {
        ...goal,
        forecastLabel: "sem previsao",
        monthsNeeded: null,
        progressPercent: 0,
      };
    }

    const monthsNeeded = Math.max(1, Math.ceil(goal.target_cents / monthlyBalanceCents));
    const forecastDate = addMonths(minDate, monthsNeeded - 1);
    const progressPercent = Math.min(
      100,
      Math.max(0, Math.round((accumulatedBalanceCents / goal.target_cents) * 100)),
    );

    return {
      ...goal,
      forecastLabel: monthLabel(forecastDate),
      monthsNeeded,
      progressPercent,
    };
  });
}

async function buildDashboardSummary(
  userId: number,
  profiles: FinanceProfile[],
  activeProfile: FinanceProfile,
  dateValue: unknown,
): Promise<DashboardSummary> {
  const minDate = todayAtMidnight();
  const maxDate = addYears(minDate, 1);
  const selectedDate = clampDate(dateValue);
  const incomeCents = await getMonthlyIncomeCents(activeProfile.id);
  const fixedExpenses = await getFixedExpenses(userId, activeProfile.id);
  const percentageExpenses = await getPercentageExpenses(userId, activeProfile.id);
  const variableExpenses = await getVariableExpenses(userId, activeProfile.id);
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
  const totalExpensesCents =
    fixedTotalCents + percentageTotalCents + variableTotalCents;
  const monthlyBalanceCents = incomeCents - totalExpensesCents;
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

  const accumulatedBalanceCents =
    projectionMonths.at(-1)?.accumulatedBalanceCents ?? 0;
  const rawGoals = await getFinancialGoals(userId, activeProfile.id);

  return {
    profiles,
    activeProfile,
    selectedDate,
    minDate: toInputDate(minDate),
    maxDate: toInputDate(maxDate),
    monthLabel: monthLabel(selectedDate),
    monthsAhead,
    incomeCents,
    fixedTotalCents,
    percentageTotalCents,
    variableTotalCents,
    totalExpensesCents,
    predictedBalanceCents: monthlyBalanceCents,
    accumulatedBalanceCents,
    fixedExpenses,
    percentageExpenses,
    variableExpenses,
    goals: buildGoalProgress(rawGoals, monthlyBalanceCents, accumulatedBalanceCents),
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

  await run(`
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, name),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(
    `
      INSERT OR IGNORE INTO profiles (user_id, name)
      SELECT id, ? FROM users
    `,
    [DEFAULT_PROFILE_NAME],
  );

  await run(`
    CREATE TABLE IF NOT EXISTS profile_settings (
      profile_id INTEGER PRIMARY KEY,
      monthly_income_cents INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    )
  `);

  if (await hasTable("finance_settings")) {
    await run(`
      INSERT OR IGNORE INTO profile_settings (profile_id, monthly_income_cents)
      SELECT profiles.id, finance_settings.monthly_income_cents
      FROM finance_settings
      INNER JOIN profiles
        ON profiles.user_id = finance_settings.user_id
       AND profiles.name = '${DEFAULT_PROFILE_NAME}'
    `);
  }

  await run(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      profile_id INTEGER,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      percentage_basis_points INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    )
  `);

  if (!(await hasColumn("expenses", "percentage_basis_points"))) {
    await run(
      "ALTER TABLE expenses ADD COLUMN percentage_basis_points INTEGER NOT NULL DEFAULT 0",
    );
  }

  if (!(await hasColumn("expenses", "profile_id"))) {
    await run("ALTER TABLE expenses ADD COLUMN profile_id INTEGER");
  }

  await run(
    `
      UPDATE expenses
      SET profile_id = (
        SELECT profiles.id
        FROM profiles
        WHERE profiles.user_id = expenses.user_id
          AND profiles.name = ?
      )
      WHERE profile_id IS NULL
    `,
    [DEFAULT_PROFILE_NAME],
  );

  await run(`
    CREATE TABLE IF NOT EXISTS financial_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      profile_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      target_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    )
  `);
}

function requireLogin(request: Request, response: Response, next: NextFunction): void {
  if (!request.session.user) {
    response.redirect("/login");
    return;
  }

  next();
}

async function activeProfileIdForRequest(request: Request): Promise<number> {
  const user = request.session.user;

  if (!user) {
    throw new Error("Usuario nao autenticado.");
  }

  const { activeProfile } = await getProfileContext(
    user.id,
    request.session.activeProfileId,
  );
  request.session.activeProfileId = activeProfile.id;
  return activeProfile.id;
}

function authPage(
  title: string,
  error: string,
  body: string,
  footer: string,
): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, sans-serif; background: #121212; color: white; }
    main { width: min(420px, calc(100vw - 32px)); padding: 32px; background: #1e1e1e; border: 1px solid #303236; border-radius: 8px; }
    h1 { margin: 0 0 18px; }
    label { display: block; margin: 16px 0 8px; color: #d7d7d7; }
    input, button { width: 100%; padding: 12px; border-radius: 6px; border: 0; }
    input { background: #2c2c2c; color: white; }
    button { margin-top: 18px; background: #707070; color: white; cursor: pointer; }
    a { color: #f0f0f0; }
    .error { padding: 12px; background: #5f2424; border-radius: 6px; }
    .footer { margin: 18px 0 0; color: #cfcfcf; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    ${body}
    <p class="footer">${footer}</p>
  </main>
</body>
</html>`;
}

function loginPage(error = "", username = ""): string {
  return authPage(
    "Login",
    error,
    `<form method="POST" action="/login">
      <label for="username">Usuario</label>
      <input id="username" name="username" value="${escapeHtml(username)}" required>
      <label for="password">Senha</label>
      <input id="password" name="password" type="password" required>
      <button type="submit">Entrar</button>
    </form>`,
    `Nao tem conta? <a href="/register">Criar conta</a>`,
  );
}

function registerPage(error = "", username = ""): string {
  return authPage(
    "Criar conta",
    error,
    `<form method="POST" action="/register">
      <label for="username">Usuario</label>
      <input id="username" name="username" minlength="3" maxlength="40" value="${escapeHtml(username)}" required>
      <label for="password">Senha</label>
      <input id="password" name="password" type="password" minlength="6" required>
      <button type="submit">Registrar</button>
    </form>`,
    `Ja tem conta? <a href="/login">Entrar</a>`,
  );
}

function chartBar(label: string, cents: number, maxCents: number, tone: string): string {
  const width = maxCents > 0 ? Math.max(3, Math.round((Math.abs(cents) / maxCents) * 100)) : 0;

  return `
    <div class="chart-row">
      <div class="chart-label">
        <span>${escapeHtml(label)}</span>
        <strong>${money(cents)}</strong>
      </div>
      <div class="chart-track">
        <div class="chart-fill ${tone}" style="width: ${width}%"></div>
      </div>
    </div>
  `;
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

  const profileOptions = summary.profiles
    .map(
      (profile) =>
        `<option value="${profile.id}"${profile.id === summary.activeProfile.id ? " selected" : ""}>${escapeHtml(profile.name)}</option>`,
    )
    .join("");

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

  const goalRows = summary.goals.length
    ? summary.goals
        .map(
          (goal) => `
            <form class="goal-row" method="POST" action="/goals/${goal.id}">
              <input name="name" value="${escapeHtml(goal.name)}" required>
              <input name="target" type="number" min="0" step="0.01" value="${(goal.target_cents / 100).toFixed(2)}" required>
              <div class="goal-progress">
                <span>${goal.forecastLabel}${goal.monthsNeeded ? ` (${goal.monthsNeeded} mes(es))` : ""}</span>
                <div class="progress-track">
                  <div class="progress-fill" style="width: ${goal.progressPercent}%"></div>
                </div>
              </div>
              <button type="submit">Salvar</button>
              <button type="submit" formaction="/goals/${goal.id}/delete">Remover</button>
            </form>
          `,
        )
        .join("")
    : `<p class="empty">Nenhuma meta cadastrada.</p>`;

  const chartMax = Math.max(
    summary.incomeCents,
    summary.fixedTotalCents,
    summary.percentageTotalCents,
    summary.variableTotalCents,
    Math.abs(summary.predictedBalanceCents),
    1,
  );
  const chartRows = [
    chartBar("Entrada", summary.incomeCents, chartMax, "income-fill"),
    chartBar("Fixos", summary.fixedTotalCents, chartMax, "fixed-fill"),
    chartBar("Percentuais", summary.percentageTotalCents, chartMax, "percentage-fill"),
    chartBar("Variaveis", summary.variableTotalCents, chartMax, "variable-fill"),
    chartBar(
      "Saldo mensal",
      summary.predictedBalanceCents,
      chartMax,
      summary.predictedBalanceCents >= 0 ? "balance-fill" : "negative-fill",
    ),
  ].join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Finance Manager</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, sans-serif; background: #0f0f10; color: white; }
    button, input, select, summary { font: inherit; }
    button { padding: 8px 10px; border: 0; border-radius: 6px; background: #747474; color: white; cursor: pointer; white-space: nowrap; }
    button:hover, button:focus { background: #8a8a8a; }
    input, select { min-width: 0; padding: 9px 10px; border: 1px solid #373737; border-radius: 6px; background: #202124; color: white; }
    .topbar { min-height: 72px; display: grid; grid-template-columns: 1fr minmax(360px, auto) auto; gap: 18px; align-items: center; padding: 14px 22px; background: #000; border-bottom: 1px solid #252525; }
    .brand { font-size: 1.45rem; font-weight: 700; }
    .profile-area { display: grid; gap: 8px; }
    .profile-select { display: grid; grid-template-columns: auto minmax(150px, 1fr) auto; gap: 8px; align-items: center; }
    .profile-create { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
    .profile-create input { padding: 7px 9px; }
    .profile-create button { padding: 7px 9px; }
    .user-box { display: flex; gap: 12px; align-items: center; justify-content: end; color: #e8e8e8; }
    .user-box form { margin: 0; }
    main { width: min(1440px, calc(100vw - 28px)); margin: 0 auto; padding: 18px 0 28px; }
    .dashboard-grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 14px; align-items: start; }
    .card { min-height: 230px; padding: 16px; background: #18191b; border: 1px solid #303236; border-radius: 8px; box-shadow: 0 12px 28px rgba(0, 0, 0, 0.22); }
    .card h2 { margin: 0; font-size: 1rem; color: #d7d7d7; }
    .card-head { display: flex; justify-content: space-between; gap: 12px; align-items: start; margin-bottom: 12px; }
    .metric { margin: 6px 0 14px; font-size: 1.65rem; font-weight: 700; }
    .small { color: #bdbdbd; font-size: 0.9rem; }
    .income-card, .fixed-card, .percentage-card, .variable-card { grid-column: span 3; }
    .balance-card, .chart-card { grid-column: span 4; }
    .forecast-card { grid-column: span 8; }
    .goals-card { grid-column: span 8; }
    .item-list, .goal-list { display: grid; gap: 8px; max-height: 210px; overflow-y: auto; overflow-x: hidden; padding-right: 4px; }
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
    .goal-row { display: grid; grid-template-columns: minmax(130px, 1fr) 130px minmax(180px, 1.1fr) auto auto; gap: 8px; align-items: center; padding: 8px; background: #111214; border: 1px solid #292b2f; border-radius: 7px; }
    .goal-row button { padding: 7px 8px; font-size: 0.84rem; }
    .goal-progress span { display: block; margin-bottom: 6px; color: #d7d7d7; font-size: 0.86rem; }
    .progress-track, .chart-track { height: 9px; overflow: hidden; background: #27292d; border-radius: 999px; }
    .progress-fill { height: 100%; background: #78a86f; }
    .chart-list { display: grid; gap: 13px; }
    .chart-label { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 6px; color: #d7d7d7; font-size: 0.9rem; }
    .chart-fill { height: 100%; border-radius: 999px; }
    .income-fill { background: #78a86f; }
    .fixed-fill { background: #b76f64; }
    .percentage-fill { background: #b89d55; }
    .variable-fill { background: #6f93b8; }
    .balance-fill { background: #70a6a0; }
    .negative-fill { background: #c44f4f; }
    @media (max-width: 1180px) {
      .income-card, .fixed-card, .percentage-card, .variable-card, .balance-card, .chart-card { grid-column: span 6; }
      .forecast-card, .goals-card { grid-column: span 12; }
      .topbar { grid-template-columns: 1fr; align-items: start; }
      .user-box { justify-content: start; }
    }
    @media (max-width: 760px) {
      .dashboard-grid { grid-template-columns: 1fr; }
      .income-card, .fixed-card, .percentage-card, .variable-card, .balance-card, .forecast-card, .goals-card, .chart-card { grid-column: span 1; }
      .compact-form, .income-form, .date-form, .item-row, .percentage-row, .goal-row, .profile-select, .profile-create { grid-template-columns: 1fr; }
      .item-row button:first-of-type, .item-row button:last-of-type, .percentage-row span { grid-column: auto; }
      .balance-grid { grid-template-columns: 1fr; }
      .user-box { flex-wrap: wrap; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">Finance Manager</div>
    <div class="profile-area">
      <form class="profile-select" method="POST" action="/profiles/select">
        <label for="profileId">perfil</label>
        <select id="profileId" name="profileId" onchange="this.form.submit()">${profileOptions}</select>
        <button type="submit">Usar</button>
      </form>
      <form class="profile-create" method="POST" action="/profiles">
        <input name="name" maxlength="40" placeholder="novo perfil">
        <button type="submit">Criar perfil</button>
      </form>
    </div>
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
          <span class="small">${escapeHtml(summary.activeProfile.name)}</span>
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
            <strong>${money(summary.totalExpensesCents)}</strong>
          </div>
          <div class="balance-box">
            <p>Periodo</p>
            <strong>${summary.monthsAhead} mes(es)</strong>
          </div>
        </div>
      </article>

      <article class="card chart-card">
        <div class="card-head">
          <h2>Grafico simples</h2>
          <span class="small">mes atual</span>
        </div>
        <div class="chart-list">${chartRows}</div>
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

      <article class="card goals-card">
        <div class="card-head">
          <h2>Metas financeiras</h2>
          <span class="small">previsao pelo saldo mensal</span>
        </div>
        <div class="goal-list">${goalRows}</div>
        <details>
          <summary>Adicionar</summary>
          <form class="compact-form" method="POST" action="/goals">
            <div class="field">
              <label for="goalName">Meta</label>
              <input id="goalName" name="name" placeholder="Ex: reserva de emergencia" required>
            </div>
            <div class="field">
              <label for="goalTarget">Valor alvo</label>
              <input id="goalTarget" name="target" type="number" min="0" step="0.01" required>
            </div>
            <button type="submit">Adicionar</button>
          </form>
        </details>
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
    const username = normalizeName(request.body.username, 40);
    const password = String(request.body.password ?? "");
    const user = await get<User>("SELECT * FROM users WHERE username = ?", [
      username,
    ]);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      response.status(401).send(loginPage("Usuario ou senha invalidos.", username));
      return;
    }

    const { activeProfile } = await getProfileContext(user.id);

    request.session.regenerate((error) => {
      if (error) {
        next(error);
        return;
      }

      request.session.user = { id: user.id, username: user.username };
      request.session.activeProfileId = activeProfile.id;
      response.redirect("/dashboard");
    });
  } catch (error) {
    next(error);
  }
});

app.get("/register", (request, response) => {
  if (request.session.user) {
    response.redirect("/dashboard");
    return;
  }

  response.send(registerPage());
});

app.post("/register", async (request, response, next) => {
  try {
    const username = normalizeName(request.body.username, 40);
    const password = String(request.body.password ?? "");

    if (username.length < 3) {
      response.status(400).send(registerPage("Use pelo menos 3 caracteres.", username));
      return;
    }

    if (password.length < 6) {
      response.status(400).send(registerPage("Use uma senha com pelo menos 6 caracteres.", username));
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await runWithResult(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)",
      [username, passwordHash],
    );
    const activeProfile = await createDefaultProfile(result.lastID);

    request.session.regenerate((error) => {
      if (error) {
        next(error);
        return;
      }

      request.session.user = { id: result.lastID, username };
      request.session.activeProfileId = activeProfile.id;
      response.redirect("/dashboard");
    });
  } catch (error) {
    const sqliteError = error as { code?: string };

    if (sqliteError.code === "SQLITE_CONSTRAINT") {
      response.status(409).send(registerPage("Esse usuario ja existe.", request.body.username));
      return;
    }

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

    const { profiles, activeProfile } = await getProfileContext(
      user.id,
      request.session.activeProfileId,
    );
    request.session.activeProfileId = activeProfile.id;
    const summary = await buildDashboardSummary(
      user.id,
      profiles,
      activeProfile,
      request.query.date,
    );
    response.send(dashboardPage(user.username, summary));
  } catch (error) {
    next(error);
  }
});

app.post("/profiles/select", requireLogin, async (request, response, next) => {
  try {
    const user = request.session.user;

    if (!user) {
      response.redirect("/login");
      return;
    }

    const profileId = Number(request.body.profileId);
    const profile = await get<FinanceProfile>(
      "SELECT id, user_id, name FROM profiles WHERE id = ? AND user_id = ?",
      [profileId, user.id],
    );

    if (profile) {
      request.session.activeProfileId = profile.id;
    }

    response.redirect("/dashboard");
  } catch (error) {
    next(error);
  }
});

app.post("/profiles", requireLogin, async (request, response, next) => {
  try {
    const user = request.session.user;

    if (!user) {
      response.redirect("/login");
      return;
    }

    const name = normalizeName(request.body.name, 40);

    if (name) {
      await run(
        `
          INSERT OR IGNORE INTO profiles (user_id, name)
          VALUES (?, ?)
        `,
        [user.id, name],
      );

      const profile = await get<FinanceProfile>(
        "SELECT id, user_id, name FROM profiles WHERE user_id = ? AND name = ?",
        [user.id, name],
      );

      if (profile) {
        request.session.activeProfileId = profile.id;
      }
    }

    response.redirect("/dashboard");
  } catch (error) {
    next(error);
  }
});

app.post("/income", requireLogin, async (request, response, next) => {
  try {
    const profileId = await activeProfileIdForRequest(request);
    const monthlyIncomeCents = parseCurrencyToCents(request.body.monthlyIncome);

    await run(
      `
        INSERT INTO profile_settings (profile_id, monthly_income_cents)
        VALUES (?, ?)
        ON CONFLICT(profile_id)
        DO UPDATE SET monthly_income_cents = excluded.monthly_income_cents
      `,
      [profileId, monthlyIncomeCents],
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

    const profileId = await activeProfileIdForRequest(request);
    const name = normalizeName(request.body.name);
    const amountCents = parseCurrencyToCents(request.body.amount);

    if (name) {
      await run(
        `
          INSERT INTO expenses (user_id, profile_id, type, name, amount_cents)
          VALUES (?, ?, 'fixed', ?, ?)
        `,
        [user.id, profileId, name, amountCents],
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

    const profileId = await activeProfileIdForRequest(request);
    const expenseId = Number(request.params.id);
    const name = normalizeName(request.body.name);
    const amountCents = parseCurrencyToCents(request.body.amount);

    if (Number.isInteger(expenseId) && name) {
      await run(
        `
          UPDATE expenses
          SET name = ?, amount_cents = ?
          WHERE id = ? AND user_id = ? AND profile_id = ? AND type = 'fixed'
        `,
        [name, amountCents, expenseId, user.id, profileId],
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

    const profileId = await activeProfileIdForRequest(request);
    const name = normalizeName(request.body.name);
    const percentageBasisPoints = parsePercentageToBasisPoints(
      request.body.percentage,
    );

    if (name) {
      await run(
        `
          INSERT INTO expenses (
            user_id,
            profile_id,
            type,
            name,
            amount_cents,
            percentage_basis_points
          )
          VALUES (?, ?, 'percentage', ?, 0, ?)
        `,
        [user.id, profileId, name, percentageBasisPoints],
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

      const profileId = await activeProfileIdForRequest(request);
      const expenseId = Number(request.params.id);
      const name = normalizeName(request.body.name);
      const percentageBasisPoints = parsePercentageToBasisPoints(
        request.body.percentage,
      );

      if (Number.isInteger(expenseId) && name) {
        await run(
          `
            UPDATE expenses
            SET name = ?, percentage_basis_points = ?
            WHERE id = ? AND user_id = ? AND profile_id = ? AND type = 'percentage'
          `,
          [name, percentageBasisPoints, expenseId, user.id, profileId],
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

    const profileId = await activeProfileIdForRequest(request);
    const name = normalizeName(request.body.name);
    const amountCents = parseCurrencyToCents(request.body.amount);

    if (name) {
      await run(
        `
          INSERT INTO expenses (user_id, profile_id, type, name, amount_cents)
          VALUES (?, ?, 'variable', ?, ?)
        `,
        [user.id, profileId, name, amountCents],
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

      const profileId = await activeProfileIdForRequest(request);
      const expenseId = Number(request.params.id);
      const name = normalizeName(request.body.name);
      const amountCents = parseCurrencyToCents(request.body.amount);

      if (Number.isInteger(expenseId) && name) {
        await run(
          `
            UPDATE expenses
            SET name = ?, amount_cents = ?
            WHERE id = ? AND user_id = ? AND profile_id = ? AND type = 'variable'
          `,
          [name, amountCents, expenseId, user.id, profileId],
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

    const profileId = await activeProfileIdForRequest(request);
    const expenseId = Number(request.params.id);

    if (Number.isInteger(expenseId)) {
      await run(
        "DELETE FROM expenses WHERE id = ? AND user_id = ? AND profile_id = ?",
        [expenseId, user.id, profileId],
      );
    }

    response.redirect("/dashboard");
  } catch (error) {
    next(error);
  }
});

app.post("/goals", requireLogin, async (request, response, next) => {
  try {
    const user = request.session.user;

    if (!user) {
      response.redirect("/login");
      return;
    }

    const profileId = await activeProfileIdForRequest(request);
    const name = normalizeName(request.body.name);
    const targetCents = parseCurrencyToCents(request.body.target);

    if (name && targetCents > 0) {
      await run(
        `
          INSERT INTO financial_goals (user_id, profile_id, name, target_cents)
          VALUES (?, ?, ?, ?)
        `,
        [user.id, profileId, name, targetCents],
      );
    }

    response.redirect("/dashboard");
  } catch (error) {
    next(error);
  }
});

app.post("/goals/:id", requireLogin, async (request, response, next) => {
  try {
    const user = request.session.user;

    if (!user) {
      response.redirect("/login");
      return;
    }

    const profileId = await activeProfileIdForRequest(request);
    const goalId = Number(request.params.id);
    const name = normalizeName(request.body.name);
    const targetCents = parseCurrencyToCents(request.body.target);

    if (Number.isInteger(goalId) && name && targetCents > 0) {
      await run(
        `
          UPDATE financial_goals
          SET name = ?, target_cents = ?
          WHERE id = ? AND user_id = ? AND profile_id = ?
        `,
        [name, targetCents, goalId, user.id, profileId],
      );
    }

    response.redirect("/dashboard");
  } catch (error) {
    next(error);
  }
});

app.post("/goals/:id/delete", requireLogin, async (request, response, next) => {
  try {
    const user = request.session.user;

    if (!user) {
      response.redirect("/login");
      return;
    }

    const profileId = await activeProfileIdForRequest(request);
    const goalId = Number(request.params.id);

    if (Number.isInteger(goalId)) {
      await run(
        "DELETE FROM financial_goals WHERE id = ? AND user_id = ? AND profile_id = ?",
        [goalId, user.id, profileId],
      );
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

app.use(
  (
    error: Error,
    _request: Request,
    response: Response,
    _next: NextFunction,
  ) => {
    console.error(error);
    response.status(500).send("Erro interno do servidor.");
  },
);

setupDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Falha ao iniciar o servidor:", error);
    process.exit(1);
  });
