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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function dashboardPage(username: string): string {
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
    main { padding: 32px; text-align: center; }
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
    <h1>Bem vindo a pagina protegida!</h1>
    <p>Voce esta logado.</p>
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

app.get("/dashboard", requireLogin, (request, response) => {
  response.send(dashboardPage(request.session.user?.username ?? ""));
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
