import { createRemoteJWKSet, jwtVerify } from "jose";

const MAX_BODY_BYTES = 512 * 1024;

type AccessIdentity = {
  userId: string;
  email: string;
};

type LedgerState = {
  accounts: unknown[];
  entries: unknown[];
  goal?: unknown;
  monthlyFixedCosts?: unknown;
  monthlyRent?: unknown;
  targetDate?: unknown;
  selectedAccountIds?: unknown[];
  isDemo?: unknown;
};

type SavePayload = {
  expectedVersion: number;
  state: LedgerState;
};

type LedgerRow = {
  state_json: string;
  version: number;
  updated_at: string;
};

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return Response.json(data, { ...init, headers });
}

async function accessIdentity(request: Request, env: Env): Promise<AccessIdentity | null> {
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!assertion) return null;

  try {
    const jwks = createRemoteJWKSet(new URL(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(assertion, jwks, {
      algorithms: ["RS256"],
      issuer: env.TEAM_DOMAIN,
      audience: env.POLICY_AUD,
    });
    if (payload.type !== "app" || typeof payload.sub !== "string" || !payload.sub || typeof payload.email !== "string" || !payload.email) return null;
    return { userId: payload.sub, email: payload.email.toLowerCase() };
  } catch {
    return null;
  }
}

async function readJsonWithLimit(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("Request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RangeError("Ledger data is too large.");
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function isLedgerState(value: unknown): value is LedgerState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<LedgerState>;
  return Array.isArray(state.accounts) && Array.isArray(state.entries) && (state.selectedAccountIds === undefined || Array.isArray(state.selectedAccountIds));
}

function isSavePayload(value: unknown): value is SavePayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<SavePayload>;
  return Number.isInteger(payload.expectedVersion) && (payload.expectedVersion ?? -1) >= 0 && isLedgerState(payload.state);
}

async function currentLedger(env: Env, userId: string): Promise<LedgerRow | null> {
  return env.LEDGER_DB.prepare("SELECT state_json, version, updated_at FROM ledger_state WHERE user_id = ?1")
    .bind(userId)
    .first<LedgerRow>();
}

async function getLedger(env: Env, identity: AccessIdentity): Promise<Response> {
  const row = await currentLedger(env, identity.userId);
  if (!row) return json({ exists: false, version: 0, user: identity.email });
  return json({ exists: true, version: row.version, updatedAt: row.updated_at, state: JSON.parse(row.state_json), user: identity.email });
}

async function saveLedger(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  let raw: unknown;
  try {
    raw = await readJsonWithLimit(request);
  } catch (error) {
    const status = error instanceof RangeError ? 413 : 400;
    return json({ error: error instanceof Error ? error.message : "Invalid JSON body." }, { status });
  }
  if (!isSavePayload(raw)) return json({ error: "Invalid ledger payload." }, { status: 400 });

  const stateJson = JSON.stringify(raw.state);
  if (new TextEncoder().encode(stateJson).byteLength > MAX_BODY_BYTES) return json({ error: "Ledger data is too large." }, { status: 413 });

  const now = new Date().toISOString();
  let result: D1Result;
  if (raw.expectedVersion === 0) {
    result = await env.LEDGER_DB.prepare(
      "INSERT OR IGNORE INTO ledger_state (user_id, state_json, version, updated_at) VALUES (?1, ?2, 1, ?3)",
    ).bind(identity.userId, stateJson, now).run();
  } else {
    result = await env.LEDGER_DB.prepare(
      "UPDATE ledger_state SET state_json = ?1, version = version + 1, updated_at = ?2 WHERE user_id = ?3 AND version = ?4",
    ).bind(stateJson, now, identity.userId, raw.expectedVersion).run();
  }

  if (result.meta.changes === 0) {
    const current = await currentLedger(env, identity.userId);
    if (!current) return json({ error: "Ledger changed; reload and try again." }, { status: 409 });
    return json({ error: "Ledger changed on another device.", version: current.version, updatedAt: current.updated_at, state: JSON.parse(current.state_json) }, { status: 409 });
  }

  return json({ ok: true, version: raw.expectedVersion + 1, updatedAt: now, user: identity.email });
}

async function apiResponse(request: Request, env: Env): Promise<Response> {
  if (String(env.SYNC_ENABLED) !== "true") return json({ error: "Cloud sync is awaiting Cloudflare Access setup." }, { status: 503 });
  const identity = await accessIdentity(request, env);
  if (!identity) return json({ error: "Cloudflare Access sign-in is required." }, { status: 401 });
  if (request.method === "GET") return getLedger(env, identity);
  if (request.method === "PUT") return saveLedger(request, env, identity);
  return json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET, PUT" } });
}

function secureAssetResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (headers.get("Content-Type")?.includes("text/html") || headers.get("Content-Type")?.includes("javascript")) headers.set("Cache-Control", "no-cache");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/ledger") return await apiResponse(request, env);
      if (url.pathname.startsWith("/api/")) return json({ error: "Not found." }, { status: 404 });
      return secureAssetResponse(await env.ASSETS.fetch(request));
    } catch (error) {
      console.error(JSON.stringify({ message: "ledger request failed", path: url.pathname, error: error instanceof Error ? error.message : String(error) }));
      return json({ error: "Unexpected server error." }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
