"use server";

import { drain, enqueueDirect } from "@/lib/notify/dispatch";
import { createSubscriber } from "@/lib/status/mutations";
import { getSettings } from "@/lib/status/settings";

export interface SubscribeState {
  status: "idle" | "sent" | "added" | "error";
  message?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Public subscription endpoint.
 *
 * The response is deliberately identical whether the address is new, already
 * subscribed, or previously unsubscribed. Saying "you are already subscribed"
 * would turn this form into an oracle for whether a given address is on the
 * list, which is not ours to disclose.
 */
export async function subscribe(
  _prev: SubscribeState,
  formData: FormData,
): Promise<SubscribeState> {
  const settings = await getSettings();
  if (!settings.allowSubscriptions) {
    return { status: "error", message: "Subscriptions are not enabled for this page." };
  }

  const type = formData.get("type");
  const endpoint = String(formData.get("endpoint") ?? "").trim();
  const componentIds = formData.getAll("componentIds").map(String).filter(Boolean);

  if (type === "email") {
    if (!EMAIL_PATTERN.test(endpoint)) {
      return { status: "error", message: "Enter a valid email address." };
    }

    const subscriber = await createSubscriber({ type: "email", endpoint, componentIds });

    if (subscriber.confirmToken) {
      await enqueueDirect(
        subscriber.id,
        {
          kind: "confirm",
          confirmUrl: `${settings.siteUrl}/subscribe/confirm?token=${subscriber.confirmToken}`,
          pageName: settings.pageName,
        },
        `confirm:${subscriber.confirmToken}`,
      );
      await drain();
    }

    return {
      status: "sent",
      message: "Check your inbox for a confirmation link. It expires when you unsubscribe.",
    };
  }

  if (type === "slack" || type === "webhook") {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      return { status: "error", message: "Enter a valid URL." };
    }
    if (url.protocol !== "https:") {
      return { status: "error", message: "The URL must use HTTPS." };
    }
    if (type === "slack" && url.hostname !== "hooks.slack.com") {
      return { status: "error", message: "That is not a Slack incoming-webhook URL." };
    }

    // A webhook owner proves control of the endpoint by receiving the payload,
    // so there is no confirmation step to run.
    const subscriber = await createSubscriber({
      type,
      endpoint,
      componentIds,
      preConfirmed: true,
    });

    return {
      status: "added",
      message:
        type === "webhook" && subscriber.secret
          ? `Subscribed. Signing secret: ${subscriber.secret} — store it now, it is not shown again.`
          : "Subscribed. Updates will be posted to that channel.",
    };
  }

  return { status: "error", message: "Pick a notification method." };
}
