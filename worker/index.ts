import handler from "vinext/server/fetch-handler";

import { runScheduled } from "./scheduled";

/**
 * vinext resolves `vinext/server/fetch-handler` to this project's App Router handler at
 * build time. We wrap it so the same Worker can also answer Cron Triggers.
 */
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handler.fetch(request, env, ctx);
  },

  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(runScheduled(controller.cron, env));
  },
} satisfies ExportedHandler<Env>;
