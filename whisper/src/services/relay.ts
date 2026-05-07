import { z } from "zod";

export const PaymentIntentSchema = z.object({
  type: z.literal("intent"),
  requestId: z.string(),
  recipient: z.string(),
  amountMicros: z.string(),
  tokenMint: z.string().nullable(),
  memo: z.string().optional(),
  merchantName: z.string().optional(),
  createdAt: z.number(),
  broadcast: z.boolean().optional(),
  paidSignature: z.string().optional(),
  paidSignatures: z.array(z.string()).optional(),
});

export const PaidPaymentSchema = z.object({
  signature: z.string(),
  payerPubkey: z.string().optional(),
  amountMicros: z.string(),
  tokenMint: z.string().nullable(),
  ts: z.number(),
});

export const MenuItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  priceMicros: z.string(),
  token: z.enum(["SOL", "USDC"]),
  emoji: z.string().optional(),
});

export const SessionSchema = z.object({
  type: z.literal("session"),
  sessionId: z.string(),
  merchantPubkey: z.string(),
  merchantName: z.string().optional(),
  acceptedTokens: z.array(z.enum(["SOL", "USDC"])),
  sessionCode: z.string().regex(/^\d{4}$/),
  menuItems: z.array(MenuItemSchema).optional(),
  createdAt: z.number(),
  expiresAt: z.number(),
  closedAt: z.number().optional(),
  paidPayments: z.array(PaidPaymentSchema),
});

export const OrderSchema = z.object({
  type: z.literal("order"),
  orderId: z.string(),
  sessionId: z.string(),
  payerPubkey: z.string(),
  merchantPubkey: z.string(),
  merchantName: z.string().optional(),
  itemId: z.string().optional(),
  itemName: z.string().optional(),
  itemEmoji: z.string().optional(),
  amountMicros: z.string(),
  tokenMint: z.string().nullable(),
  token: z.enum(["SOL", "USDC"]),
  createdAt: z.number(),
  settledAt: z.number().optional(),
  signature: z.string().optional(),
});

export const LookupSchema = z.discriminatedUnion("type", [
  PaymentIntentSchema,
  SessionSchema,
  OrderSchema,
]);

export type PaymentIntent = z.infer<typeof PaymentIntentSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type PaidPayment = z.infer<typeof PaidPaymentSchema>;
export type Lookup = z.infer<typeof LookupSchema>;
export type MenuItem = z.infer<typeof MenuItemSchema>;
export type Order = z.infer<typeof OrderSchema>;

export class RelayClient {
  constructor(private baseUrl: string) {}

  async createIntent(
    intent: Omit<
      PaymentIntent,
      "type" | "requestId" | "createdAt" | "paidSignature" | "paidSignatures"
    >,
    requestId: string,
  ): Promise<PaymentIntent> {
    const body = {
      ...intent,
      requestId,
      createdAt: Date.now(),
    };
    const res = await fetch(`${this.baseUrl}/intents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`relay createIntent failed: ${res.status}`);
    return PaymentIntentSchema.parse(await res.json());
  }

  async openSession(
    session: Omit<
      Session,
      "type" | "createdAt" | "expiresAt" | "paidPayments" | "closedAt"
    >,
  ): Promise<Session> {
    const res = await fetch(`${this.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(session),
    });
    if (!res.ok) throw new Error(`relay openSession failed: ${res.status}`);
    return SessionSchema.parse(await res.json());
  }

  async refreshSession(sessionId: string): Promise<Session> {
    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}/refresh`, {
      method: "POST",
    });
    if (!res.ok) throw new Error(`relay refreshSession failed: ${res.status}`);
    return SessionSchema.parse(await res.json());
  }

  async getSession(sessionId: string): Promise<Session> {
    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}`);
    if (!res.ok) throw new Error(`relay getSession failed: ${res.status}`);
    return SessionSchema.parse(await res.json());
  }

  async closeSession(sessionId: string): Promise<void> {
    await fetch(`${this.baseUrl}/sessions/${sessionId}/close`, {
      method: "POST",
    }).catch(() => {});
  }

  async lookup(id: string): Promise<Lookup> {
    const res = await fetch(`${this.baseUrl}/lookup/${id}`);
    if (!res.ok) throw new Error(`relay lookup failed: ${res.status}`);
    return LookupSchema.parse(await res.json());
  }

  async ackIntentPaid(requestId: string, signature: string): Promise<void> {
    await fetch(`${this.baseUrl}/intents/${requestId}/paid`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signature }),
    }).catch(() => {});
  }

  async ackSessionPaid(
    sessionId: string,
    payment: Omit<PaidPayment, "ts">,
  ): Promise<void> {
    await fetch(`${this.baseUrl}/sessions/${sessionId}/paid`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payment),
    }).catch(() => {});
  }

  async createOrder(
    order: Omit<Order, "type" | "createdAt" | "settledAt" | "signature">,
  ): Promise<Order> {
    const res = await fetch(`${this.baseUrl}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(order),
    });
    if (!res.ok) throw new Error(`relay createOrder failed: ${res.status}`);
    return OrderSchema.parse(await res.json());
  }

  async getOrder(orderId: string): Promise<Order> {
    const res = await fetch(`${this.baseUrl}/orders/${orderId}`);
    if (!res.ok) throw new Error(`relay getOrder failed: ${res.status}`);
    return OrderSchema.parse(await res.json());
  }

  async settleOrder(orderId: string, signature: string): Promise<Order> {
    const res = await fetch(`${this.baseUrl}/orders/${orderId}/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signature }),
    });
    if (!res.ok) throw new Error(`relay settleOrder failed: ${res.status}`);
    return OrderSchema.parse(await res.json());
  }

  // Backwards-compat wrappers used by older code paths.
  async fetchIntent(requestId: string): Promise<PaymentIntent> {
    const res = await fetch(`${this.baseUrl}/intents/${requestId}`);
    if (!res.ok) throw new Error(`relay fetchIntent failed: ${res.status}`);
    return PaymentIntentSchema.parse(await res.json());
  }

  async ackPaid(requestId: string, signature: string): Promise<void> {
    return this.ackIntentPaid(requestId, signature);
  }
}
