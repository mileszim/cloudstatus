"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2Icon, AlertTriangleIcon } from "lucide-react";

import { subscribe, type SubscribeState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ComponentRow } from "@/lib/status/types";
import { cn } from "@/lib/utils";

type Channel = "email" | "slack" | "webhook";

const CHANNELS: Array<{ value: Channel; label: string; placeholder: string; hint: string }> = [
  {
    value: "email",
    label: "Email",
    placeholder: "you@example.com",
    hint: "We send a confirmation link first. Unsubscribe from any message.",
  },
  {
    value: "slack",
    label: "Slack",
    placeholder: "https://hooks.slack.com/services/…",
    hint: "Paste an incoming-webhook URL. Updates post as messages in that channel.",
  },
  {
    value: "webhook",
    label: "Webhook",
    placeholder: "https://example.com/hooks/status",
    hint: "Receives signed JSON on every update. You get a signing secret once.",
  },
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Subscribing…" : "Subscribe"}
    </Button>
  );
}

export function SubscribeForm({ components }: { components: ComponentRow[] }) {
  const [state, formAction] = useActionState<SubscribeState, FormData>(subscribe, {
    status: "idle",
  });
  const [channel, setChannel] = useState<Channel>("email");
  const [filtered, setFiltered] = useState(false);

  const active = CHANNELS.find((c) => c.value === channel)!;
  const done = state.status === "sent" || state.status === "added";

  if (done) {
    return (
      <div className="bg-operational-soft flex items-start gap-3 rounded-lg border px-5 py-4">
        <CheckCircle2Icon className="text-operational mt-0.5 size-5 shrink-0" />
        <div>
          <p className="text-sm font-medium">You&rsquo;re subscribed</p>
          <p className="text-muted-foreground mt-1 text-sm break-words">{state.message}</p>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="type" value={channel} />

      <div className="bg-secondary flex w-fit rounded-md p-0.5 text-sm" role="tablist">
        {CHANNELS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={channel === option.value}
            onClick={() => setChannel(option.value)}
            className={cn(
              "rounded-[5px] px-3 py-1.5 transition-colors",
              channel === option.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="endpoint">
          {channel === "email" ? "Email address" : "Webhook URL"}
        </Label>
        <Input
          id="endpoint"
          name="endpoint"
          type={channel === "email" ? "email" : "url"}
          placeholder={active.placeholder}
          required
          autoComplete={channel === "email" ? "email" : "off"}
        />
        <p className="text-muted-foreground text-xs">{active.hint}</p>
      </div>

      {components.length > 0 && (
        <div className="flex flex-col gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={filtered}
              onChange={(event) => setFiltered(event.target.checked)}
              className="border-input accent-primary size-4 rounded"
            />
            Only notify me about specific services
          </label>

          {filtered && (
            <ul className="grid gap-1.5 rounded-md border px-3 py-2.5 sm:grid-cols-2">
              {components.map((component) => (
                <li key={component.id}>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="componentIds"
                      value={component.id}
                      className="border-input accent-primary size-4 rounded"
                    />
                    {component.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {state.status === "error" && (
        <p
          role="alert"
          className="text-major bg-major-soft flex items-start gap-2 rounded-md px-3 py-2 text-sm"
        >
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          {state.message}
        </p>
      )}

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}
