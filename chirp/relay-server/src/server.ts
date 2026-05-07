import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";

type PaymentIntent = {
  type: "intent";
  requestId: string;
  recipient: string;
  amountMicros: string;
  tokenMint: string | null;
  memo?: string;
  merchantName?: string;
  createdAt: number;
  broadcast?: boolean;
  paidSignature?: string;
  paidSignatures?: string[];
};

type PaidPayment = {
  signature: string;
  payerPubkey?: string;
  amountMicros: string;
  tokenMint: string | null;
  ts: number;
};

type MenuItem = {
  id: string;
  name: string;
  priceMicros: string;
  token: "SOL" | "USDC";
  emoji?: string;
};

type Session = {
  type: "session";
  sessionId: string;
  merchantPubkey: string;
  merchantName?: string;
  acceptedTokens: ("SOL" | "USDC")[];
  sessionCode: string;
  menuItems?: MenuItem[];
  createdAt: number;
  expiresAt: number;
  closedAt?: number;
  paidPayments: PaidPayment[];
};

type Order = {
  type: "order";
  orderId: string;
  sessionId: string;
  payerPubkey: string;
  merchantPubkey: string;
  merchantName?: string;
  itemId?: string;
  itemName?: string;
  itemEmoji?: string;
  amountMicros: string;
  tokenMint: string | null;
  token: "SOL" | "USDC";
  createdAt: number;
  settledAt?: number;
  signature?: string;
};

const INTENT_TTL_MS = 5 * 60 * 1000;
const SESSION_DEFAULT_TTL_MS = 60 * 1000;
const SESSION_GRACE_AFTER_CLOSE_MS = 5 * 60 * 1000;
const ORDER_TTL_MS = 5 * 60 * 1000;

const intents = new Map<string, PaymentIntent>();
const sessions = new Map<string, Session>();
const orders = new Map<string, Order>();

type ChirpEvent = { id: number; payload: string; ts: number };
const channels = new Map<string, ChirpEvent[]>();
let nextEventId = 1;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of intents) {
    if (now - v.createdAt > INTENT_TTL_MS) intents.delete(k);
  }
  for (const [k, s] of sessions) {
    const closeAge = s.closedAt ? now - s.closedAt : 0;
    if (s.closedAt && closeAge > SESSION_GRACE_AFTER_CLOSE_MS) {
      sessions.delete(k);
      continue;
    }
    if (!s.closedAt && now > s.expiresAt + SESSION_GRACE_AFTER_CLOSE_MS) {
      sessions.delete(k);
    }
  }
  for (const [k, o] of orders) {
    if (now - o.createdAt > ORDER_TTL_MS && !o.settledAt) orders.delete(k);
    else if (o.settledAt && now - o.settledAt > ORDER_TTL_MS) orders.delete(k);
  }
  for (const [k, evs] of channels) {
    const fresh = evs.filter((e) => now - e.ts < 30_000);
    if (fresh.length === 0) channels.delete(k);
    else channels.set(k, fresh);
  }
}, 10_000);

const app = new Hono();
app.use("*", cors());

app.get("/health", (c) =>
  c.json({ ok: true, intents: intents.size, sessions: sessions.size }),
);

// ─── Intents (Charge $X / Tip jar) ─────────────────────────────────────────
app.post("/intents", async (c) => {
  const body = (await c.req.json()) as Omit<PaymentIntent, "type">;
  if (!body.requestId || !body.recipient || !body.amountMicros) {
    return c.json({ error: "missing fields" }, 400);
  }
  const stored: PaymentIntent = { type: "intent", ...body };
  intents.set(stored.requestId, stored);
  return c.json(stored);
});

app.post("/intents/:id/paid", async (c) => {
  const intent = intents.get(c.req.param("id"));
  if (!intent) return c.json({ error: "not found" }, 404);
  const { signature } = (await c.req.json()) as { signature: string };
  if (intent.broadcast) {
    intent.paidSignatures = [...(intent.paidSignatures ?? []), signature];
  } else {
    intent.paidSignature = signature;
  }
  intents.set(intent.requestId, intent);
  return c.json(intent);
});

// ─── Sessions (Open terminal) ──────────────────────────────────────────────
app.post("/sessions", async (c) => {
  const body = (await c.req.json()) as Omit<
    Session,
    "type" | "createdAt" | "expiresAt" | "paidPayments" | "closedAt"
  >;
  if (!body.sessionId || !body.merchantPubkey || !body.sessionCode) {
    return c.json({ error: "missing fields" }, 400);
  }
  if (!/^\d{4}$/.test(body.sessionCode)) {
    return c.json({ error: "sessionCode must be 4 digits" }, 400);
  }
  const now = Date.now();
  const session: Session = {
    type: "session",
    ...body,
    createdAt: now,
    expiresAt: now + SESSION_DEFAULT_TTL_MS,
    paidPayments: [],
  };
  sessions.set(session.sessionId, session);
  return c.json(session);
});

app.post("/sessions/:id/refresh", (c) => {
  const session = sessions.get(c.req.param("id"));
  if (!session) return c.json({ error: "not found" }, 404);
  if (session.closedAt) return c.json({ error: "session closed" }, 410);
  session.expiresAt = Date.now() + SESSION_DEFAULT_TTL_MS;
  sessions.set(session.sessionId, session);
  return c.json(session);
});

app.post("/sessions/:id/paid", async (c) => {
  const session = sessions.get(c.req.param("id"));
  if (!session) return c.json({ error: "not found" }, 404);
  const now = Date.now();
  const expired = !session.closedAt && now > session.expiresAt;
  if (expired) return c.json({ error: "session expired" }, 410);
  const closedTooLong =
    session.closedAt && now - session.closedAt > SESSION_GRACE_AFTER_CLOSE_MS;
  if (closedTooLong) return c.json({ error: "session closed" }, 410);
  const body = (await c.req.json()) as PaidPayment;
  if (!body.signature || !body.amountMicros) {
    return c.json({ error: "missing fields" }, 400);
  }
  session.paidPayments.push({ ...body, ts: Date.now() });
  sessions.set(session.sessionId, session);
  return c.json(session);
});

app.post("/sessions/:id/close", (c) => {
  const session = sessions.get(c.req.param("id"));
  if (!session) return c.json({ error: "not found" }, 404);
  if (!session.closedAt) session.closedAt = Date.now();
  sessions.set(session.sessionId, session);
  return c.json(session);
});

// ─── Orders (phone-initiated, phone chirps ID back to cashier) ─────────────
app.post("/orders", async (c) => {
  const body = (await c.req.json()) as Omit<Order, "type" | "createdAt">;
  if (
    !body.orderId ||
    !body.sessionId ||
    !body.payerPubkey ||
    !body.amountMicros ||
    !body.merchantPubkey
  ) {
    return c.json({ error: "missing fields" }, 400);
  }
  const stored: Order = { type: "order", ...body, createdAt: Date.now() };
  orders.set(stored.orderId, stored);
  return c.json(stored);
});

app.get("/orders/:id", (c) => {
  const order = orders.get(c.req.param("id"));
  if (!order) return c.json({ error: "not found" }, 404);
  return c.json(order);
});

app.post("/orders/:id/settle", async (c) => {
  const order = orders.get(c.req.param("id"));
  if (!order) return c.json({ error: "not found" }, 404);
  const { signature } = (await c.req.json()) as { signature: string };
  if (!signature) return c.json({ error: "missing signature" }, 400);
  order.signature = signature;
  order.settledAt = Date.now();
  orders.set(order.orderId, order);
  return c.json(order);
});

// ─── Unified lookup (chirp ID is opaque to either side) ───────────────────
app.get("/lookup/:id", (c) => {
  const id = c.req.param("id");
  const session = sessions.get(id);
  if (session) return c.json(session);
  const order = orders.get(id);
  if (order) return c.json(order);
  const intent = intents.get(id);
  if (intent) return c.json(intent);
  return c.json({ error: "not found" }, 404);
});

// (Legacy direct intent fetch — kept for compat)
app.get("/intents/:id", (c) => {
  const intent = intents.get(c.req.param("id"));
  if (!intent) return c.json({ error: "not found" }, 404);
  return c.json(intent);
});

app.get("/sessions/:id", (c) => {
  const session = sessions.get(c.req.param("id"));
  if (!session) return c.json({ error: "not found" }, 404);
  return c.json(session);
});

// ─── Chirp pub/sub for the dev relay channel ──────────────────────────────
app.post("/chirp/:channel", async (c) => {
  const channel = c.req.param("channel");
  const { payload } = (await c.req.json()) as { payload: string };
  if (!payload) return c.json({ error: "missing payload" }, 400);
  const event: ChirpEvent = { id: nextEventId++, payload, ts: Date.now() };
  const list = channels.get(channel) ?? [];
  list.push(event);
  channels.set(channel, list);
  return c.json({ ok: true, id: event.id });
});

app.get("/chirp/:channel/listen", (c) => {
  const channel = c.req.param("channel");
  const cursor = parseInt(c.req.query("cursor") ?? "0", 10);
  const all = channels.get(channel) ?? [];
  const events = all.filter((e) => e.id > cursor);
  const next = events.length ? events[events.length - 1].id : cursor;
  return c.json({ events, next });
});

const port = parseInt(process.env.PORT ?? "8787", 10);
console.log(`Whisper relay on :${port}`);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
