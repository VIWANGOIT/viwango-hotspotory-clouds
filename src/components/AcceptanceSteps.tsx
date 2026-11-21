import type { AcceptanceStepView } from "@/lib/types";
import { StatusPill } from "./StatusPill";

const labels: Record<AcceptanceStepView["status"], string> = {
  pass: "pass",
  warn: "warning",
  fail: "failed",
  skip: "skipped",
};

export function AcceptanceSteps({ steps }: { steps: AcceptanceStepView[] }) {
  if (steps.length === 0) {
    return <p className="text-sm text-white/45">This router has not been checked yet.</p>;
  }

  return (
    <ol className="space-y-2">
      {steps.map((step) => (
        <li key={step.id} className="flex items-start gap-3 rounded-lg border border-white/8 bg-black/20 px-3 py-2">
          <StatusPill status={step.status} label={labels[step.status]} />
          <div className="min-w-0">
            <p className="text-sm text-white/85">{step.label}</p>
            {step.detail && <p className="mt-0.5 text-xs leading-relaxed text-white/45">{step.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
