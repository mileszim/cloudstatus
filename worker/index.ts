import handler from "vinext/server/fetch-handler";

import type { QueuedNotification } from "@/lib/notify/dispatch";
import { handleNotificationBatch } from "./queue";
import { runScheduled } from "./scheduled";

/**
 * vinext resolves `vinext/server/fetch-handler` to this project's App Router handler at
 * build time. We wrap it so the same Worker also answers Cron Triggers and the
 * notification queue.
 */
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handler.fetch(request, env, ctx);
  },

  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(runScheduled(controller.cron, env));
  },

  queue(
    batch: MessageBatch<QueuedNotification>,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    return handleNotificationBatch(batch, env, ctx);
  },
} satisfies ExportedHandler<Env, QueuedNotification>;
