import type { PlanChange } from "@/services/work/plan";

/** What accepting a plan would create, in the order the founder will do it. */
export function PlanDetails({ plan }: { plan: PlanChange }) {
  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3 text-sm">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted">Objective</p>
        <p>{plan.objective.title}</p>
        {plan.objective.successCriteria && <p className="text-muted">Success: {plan.objective.successCriteria}</p>}
      </div>
      {plan.experiments.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider text-muted">Experiments</p>
          <ul className="mt-1 space-y-1.5">
            {plan.experiments.map((e, i) => (
              <li key={i}>
                <span>{e.hypothesis}</span>
                {e.method && <span className="text-muted"> — {e.method}</span>}
                <span className="block text-xs text-muted">
                  Tests: {plan.assumptions[e.assumption]?.title}
                  {plan.assumptions[e.assumption]?.itemId ? "" : " (new assumption, untested)"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.tasks.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider text-muted">Tasks</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            {plan.tasks.map((t, i) => (
              <li key={i}>
                {t.title}
                <span className="text-xs text-muted">
                  {" "}
                  · {t.priority}
                  {t.dueInDays !== null ? ` · in ${t.dueInDays}d` : ""}
                  {t.dependsOn.length ? ` · after ${t.dependsOn.map((d) => d + 1).join(", ")}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
