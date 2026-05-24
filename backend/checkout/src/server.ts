import express, { type NextFunction, type Request, type Response } from "express";
import type { Redis } from "ioredis";
import type { CheckoutConfig } from "./config";
import type { EmbedText } from "./embeddings";
import { ApiError, errorBody, toApiError } from "./errors";
import { withIdempotency } from "./idempotency";
import type { InventoryScripts } from "./inventoryScripts";
import {
  analyticsDashboard,
  metricsMiddleware,
  prometheusMetrics,
  recordCheckoutFailure,
  recordOrderMetric,
} from "./metrics";
import {
  listRecentLogs,
  observabilityHealth,
  recordLog,
  topErrors,
  traceEvents,
  traceMiddleware,
  type TraceRequest,
} from "./observability";
import {
  type CheckoutQueues,
  type CheckoutQueueEvents,
  releaseReservations,
  reserveJobOptions,
} from "./queues";
import {
  ORDER_STREAM_KEY,
  createOrder,
  getOrder,
  getProduct,
  listProducts,
  listOrdersForUser,
  requireOwnedOrder,
  transitionOrder,
} from "./store";
import { parseNumericFilter, semanticSearchProducts, similarProducts } from "./search";
import type { ApiEnvelope, CartItemInput, Order } from "./types";

export interface CheckoutAppContext {
  client: Redis;
  scripts: InventoryScripts;
  queues: CheckoutQueues;
  events: CheckoutQueueEvents;
  config: CheckoutConfig;
  embedText: EmbedText;
}

interface AuthedRequest extends TraceRequest {
  userId?: string;
}

function userIdFrom(request: Request): string {
  const userId = request.header("X-User-Id");
  if (!userId) {
    throw new ApiError(401, "unauthorized", "X-User-Id header is required.");
  }
  return userId;
}

function idempotencyKeyFrom(request: Request): string {
  const key = request.header("Idempotency-Key");
  if (!key) {
    throw new ApiError(400, "missing_idempotency_key", "Idempotency-Key header is required.");
  }
  return key;
}

function validateCartItems(value: unknown): CartItemInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApiError(400, "invalid_request", "items must be a non-empty array.");
  }

  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new ApiError(400, "invalid_request", "Each item must be an object.");
    }

    const candidate = item as Record<string, unknown>;
    if (typeof candidate.productId !== "string" || !Number.isInteger(candidate.quantity)) {
      throw new ApiError(400, "invalid_request", "Each item requires productId and integer quantity.");
    }

    return {
      productId: candidate.productId,
      quantity: Number(candidate.quantity),
    };
  });
}

function sendEnvelope(response: Response, envelope: ApiEnvelope): void {
  response.status(envelope.status).json(envelope.body);
}

async function waitForOrderJob(
  orderId: string,
  jobPromise: Promise<unknown>,
  client: Redis
): Promise<Order> {
  await jobPromise;
  const order = await getOrder(client, orderId);
  if (!order) {
    throw new ApiError(404, "order_not_found", "Order was not found.");
  }
  return order;
}

export function createCheckoutApp(context: CheckoutAppContext) {
  const app = express();
  app.use(traceMiddleware(context.client));
  app.use(corsMiddleware(context.config.corsOrigin));
  app.use(express.json());
  app.use(metricsMiddleware(context.client));

  app.get("/api/products", async (_request, response, next) => {
    try {
      const products = await listProducts(context.client);
      response.json({ products });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/products/:id", async (request, response, next) => {
    try {
      const product = await getProduct(context.client, request.params.id);
      if (!product || product.status !== "active") {
        throw new ApiError(404, "product_not_found", "Product was not found.");
      }
      response.json({ product });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/search/semantic", async (request, response, next) => {
    try {
      const query = typeof request.query.q === "string" ? request.query.q.trim() : "";
      if (!query) {
        throw new ApiError(400, "invalid_request", "q query parameter is required.");
      }

      const results = await semanticSearchProducts(context.client, context.embedText, query, {
        categoryId: typeof request.query.categoryId === "string" ? request.query.categoryId : undefined,
        minPrice: parseNumericFilter(request.query.minPrice),
        maxPrice: parseNumericFilter(request.query.maxPrice),
        limit: parseNumericFilter(request.query.limit) ?? 8,
      });
      response.json({ query, results });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/products/:id/similar", async (request, response, next) => {
    try {
      const product = await getProduct(context.client, request.params.id);
      if (!product || product.status !== "active") {
        throw new ApiError(404, "product_not_found", "Product was not found.");
      }

      const results = await similarProducts(
        context.client,
        context.embedText,
        request.params.id,
        parseNumericFilter(request.query.limit) ?? 4
      );
      response.json({ productId: request.params.id, results });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/search/by-image", async (_request, response) => {
    response.status(501).json(
      errorBody("not_implemented", "Image embeddings are outside this demo scope; use semantic text search.")
    );
  });

  app.get("/metrics", async (_request, response, next) => {
    try {
      response.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
      response.send(await prometheusMetrics(context.client));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/analytics/dashboard", async (_request, response, next) => {
    try {
      response.json({ dashboard: await analyticsDashboard(context.client) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/observability/logs", async (request, response, next) => {
    try {
      response.json({ logs: await listRecentLogs(context.client, parseNumericFilter(request.query.limit) ?? 100) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/observability/traces/:traceId", async (request, response, next) => {
    try {
      response.json(await traceEvents(context.client, request.params.traceId));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/observability/errors", async (_request, response, next) => {
    try {
      response.json({ errors: await topErrors(context.client) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/observability/health", async (_request, response, next) => {
    try {
      response.json({ health: await observabilityHealth(context.client, context.config) });
    } catch (error) {
      next(error);
    }
  });

  app.use((request: AuthedRequest, _response, next) => {
    try {
      request.userId = userIdFrom(request);
      next();
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/checkout/start", async (request: AuthedRequest, response, next) => {
    try {
      const userId = request.userId!;
      const key = idempotencyKeyFrom(request);

      const envelope = await withIdempotency(context.client, userId, key, async () => {
        const body = request.body as Record<string, unknown>;
        const items = validateCartItems(body.items);
        const shippingAddress =
          body.shippingAddress && typeof body.shippingAddress === "object"
            ? (body.shippingAddress as Record<string, unknown>)
            : {};

        const order = await createOrder(context.client, userId, items, shippingAddress);
        const job = await context.queues.inventoryReserve.add(
          `reserve:${order.id}`,
          { orderId: order.id },
          reserveJobOptions()
        );

        const updatedOrder = await waitForOrderJob(
          order.id,
          job.waitUntilFinished(context.events.inventoryReserve, 5000),
          context.client
        );

        if (updatedOrder.status === "inventory_reserve_failed") {
          await recordCheckoutFailure(context.client, {
            reason: "insufficient_stock",
            orderId: updatedOrder.id,
          });
          await recordLog(context.client, {
            level: "warn",
            event: "checkout_inventory_failed",
            traceId: request.traceId!,
            message: "Inventory reservation failed.",
            orderId: updatedOrder.id,
            userId,
          });
          return {
            status: 409,
            body: errorBody("insufficient_stock", "One or more products do not have enough available stock.", {
              orderId: updatedOrder.id,
            }),
          };
        }

        return {
          status: 201,
          body: { order: updatedOrder },
        };
      });

      sendEnvelope(response, envelope);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/checkout/payment", async (request: AuthedRequest, response, next) => {
    try {
      const userId = request.userId!;
      const key = idempotencyKeyFrom(request);

      const envelope = await withIdempotency(context.client, userId, key, async () => {
        const { orderId, paymentInput } = request.body as {
          orderId?: unknown;
          paymentInput?: Record<string, unknown>;
        };
        if (typeof orderId !== "string") {
          throw new ApiError(400, "invalid_request", "orderId is required.");
        }

        const order = await requireOwnedOrder(context.client, orderId, userId);
        if (order.status !== "pending_payment") {
          throw new ApiError(409, "invalid_order_state", "Order is not pending payment.");
        }
        const job = await context.queues.paymentProcess.add(
          `payment:${orderId}`,
          { orderId, paymentInput },
          { attempts: 2, backoff: { type: "exponential", delay: 200 }, removeOnComplete: true }
        );
        const updatedOrder = await waitForOrderJob(
          orderId,
          job.waitUntilFinished(context.events.paymentProcess, 5000),
          context.client
        );

        if (updatedOrder.status === "payment_failed") {
          await recordCheckoutFailure(context.client, { reason: "payment_declined", orderId: updatedOrder.id });
          await recordLog(context.client, {
            level: "warn",
            event: "checkout_payment_failed",
            traceId: request.traceId!,
            message: "Payment was declined.",
            orderId: updatedOrder.id,
            userId,
          });
        }

        return {
          status: updatedOrder.status === "payment_failed" ? 402 : 200,
          body: { order: updatedOrder },
        };
      });

      sendEnvelope(response, envelope);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/checkout/confirm", async (request: AuthedRequest, response, next) => {
    try {
      const userId = request.userId!;
      const key = idempotencyKeyFrom(request);

      const envelope = await withIdempotency(context.client, userId, key, async () => {
        const { orderId } = request.body as { orderId?: unknown };
        if (typeof orderId !== "string") {
          throw new ApiError(400, "invalid_request", "orderId is required.");
        }

        const order = await requireOwnedOrder(context.client, orderId, userId);
        if (order.status !== "payment_authorized") {
          throw new ApiError(409, "invalid_order_state", "Order must be payment_authorized before confirmation.");
        }
        const job = await context.queues.orderConfirm.add(
          `confirm:${orderId}`,
          { orderId },
          { attempts: 3, backoff: { type: "exponential", delay: 200 }, removeOnComplete: true }
        );
        const updatedOrder = await waitForOrderJob(
          orderId,
          job.waitUntilFinished(context.events.orderConfirm, 5000),
          context.client
        );
        await recordOrderMetric(context.client, updatedOrder.total);
        await recordLog(context.client, {
          level: "info",
          event: "checkout_order_confirmed",
          traceId: request.traceId!,
          message: "Order confirmed.",
          orderId: updatedOrder.id,
          userId,
          details: { total: updatedOrder.total },
        });

        return {
          status: 200,
          body: { order: updatedOrder },
        };
      });

      sendEnvelope(response, envelope);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/checkout/cancel", async (request: AuthedRequest, response, next) => {
    try {
      const userId = request.userId!;
      const { orderId } = request.body as { orderId?: unknown };
      if (typeof orderId !== "string") {
        throw new ApiError(400, "invalid_request", "orderId is required.");
      }

      const order = await requireOwnedOrder(context.client, orderId, userId);
      if (["confirmed", "cancelled", "released", "inventory_reserve_failed"].includes(order.status)) {
        throw new ApiError(409, "invalid_order_state", "Order is already terminal.");
      }

      await releaseReservations(context.client, context.scripts, order);
      const cancelled = await transitionOrder(context.client, order, "cancelled");
      response.json({ order: cancelled });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/orders", async (request: AuthedRequest, response, next) => {
    try {
      const orders = await listOrdersForUser(context.client, request.userId!);
      response.json({ orders });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/orders/:id", async (request: AuthedRequest, response, next) => {
    try {
      const order = await requireOwnedOrder(context.client, request.params.id, request.userId!);
      response.json({ order });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/orders/:id/events", async (request: AuthedRequest, response, next) => {
    try {
      await requireOwnedOrder(context.client, request.params.id, request.userId!);

      response.setHeader("Content-Type", "text/event-stream");
      response.setHeader("Cache-Control", "no-cache");
      response.setHeader("Connection", "keep-alive");
      response.flushHeaders?.();

      let active = true;
      let lastId = "$";
      request.on("close", () => {
        active = false;
      });

      while (active) {
        const rows = (await context.client.xread(
          "BLOCK",
          1000,
          "STREAMS",
          ORDER_STREAM_KEY,
          lastId
        )) as Array<[string, Array<[string, string[]]>]> | null;

        if (!rows) {
          continue;
        }

        for (const [, entries] of rows) {
          for (const [entryId, fields] of entries) {
            lastId = entryId;
            const event = Object.fromEntries(
              Array.from({ length: fields.length / 2 }, (_, index) => [
                fields[index * 2],
                fields[index * 2 + 1],
              ])
            );
            if (event.orderId === request.params.id) {
              response.write(`id: ${entryId}\n`);
              response.write(`event: order\n`);
              response.write(`data: ${JSON.stringify(event)}\n\n`);
            }
          }
        }
      }

      response.end();
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, request: TraceRequest, response: Response, _next: express.NextFunction) => {
    const apiError = toApiError(error);
    void recordLog(context.client, {
      level: apiError.status >= 500 ? "error" : "warn",
      event: "api_error",
      traceId: request.traceId ?? "missing-trace",
      message: apiError.message,
      route: request.path,
      method: request.method,
      status: apiError.status,
      error: apiError.error,
      details: apiError.details,
    });
    response.status(apiError.status).json(errorBody(apiError.error, apiError.message, apiError.details));
  });

  return app;
}

function corsMiddleware(corsOrigin: string) {
  const configuredOrigins = corsOrigin.split(",").map((origin) => origin.trim()).filter(Boolean);
  return (request: Request, response: Response, next: NextFunction) => {
    const requestOrigin = request.header("Origin");
    const allowOrigin =
      configuredOrigins.includes("*") || configuredOrigins.length === 0
        ? "*"
        : requestOrigin && configuredOrigins.includes(requestOrigin)
          ? requestOrigin
          : configuredOrigins[0];

    response.setHeader("Access-Control-Allow-Origin", allowOrigin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type,X-User-Id,Idempotency-Key,X-Trace-Id");
    response.setHeader("Access-Control-Expose-Headers", "X-Trace-Id");

    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }

    next();
  };
}
