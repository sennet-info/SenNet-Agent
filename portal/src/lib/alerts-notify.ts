import { AlertEvent, AlertRule } from "@/lib/alerts-types";

type DeliveryResult = {
  email: {
    enabled: boolean;
    recipients: string[];
    mode: "preview";
  };
  webhook?: {
    attempted: boolean;
    ok: boolean;
    status?: number;
    detail?: string;
  };
};

function uniqEmails(values: string[]) {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

export async function notifyForEvent(rule: AlertRule, event: AlertEvent): Promise<DeliveryResult> {
  const groupEmails = [...(rule.notifications.groups?.client ?? []), ...(rule.notifications.groups?.maintenance ?? [])];
  const recipients = uniqEmails([...(rule.notifications.emails ?? []), ...groupEmails]);

  const email = {
    enabled: recipients.length > 0,
    recipients,
    mode: "preview" as const,
  };

  if (email.enabled) {
    console.log("[alerts-notify] email preview", {
      ruleId: rule.id,
      severity: event.severity,
      recipients,
      subject: `[SenNet][${event.severity}] ${rule.name}`,
    });
  }

  const webhookUrl = rule.notifications.webhookUrl?.trim();
  if (!webhookUrl) {
    return { email };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rule, event }),
      signal: controller.signal,
    });
    return {
      email,
      webhook: {
        attempted: true,
        ok: response.ok,
        status: response.status,
        detail: response.ok ? "ok" : `HTTP ${response.status}`,
      },
    };
  } catch (error) {
    return {
      email,
      webhook: {
        attempted: true,
        ok: false,
        detail: error instanceof Error ? error.message : "webhook error",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
