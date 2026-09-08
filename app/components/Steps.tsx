"use client";

/**
 * What is happening while nothing appears to happen.
 *
 * The waits here are short — a commitment opens in about three and a half
 * seconds, stopping one in about one — but they are the moments where a person
 * decides whether this thing works. A bare "Confirming…" gives them nothing to
 * read, and on a first visit that reads as broken rather than busy.
 *
 * So the steps are named, and they are the real ones. No countdown: the timings
 * are short enough that a number would flicker, and one of the steps quietly
 * covers a variable amount of work, so a promise of seconds would sometimes be
 * a lie.
 */

export type StepsProps = {
  /** In order. The last is the one that finishes the flow. */
  steps: readonly string[];
  /** Index of the step under way. Everything before it is done. */
  current: number;
};

export default function Steps({ steps, current }: StepsProps) {
  return (
    <ol className="steps" role="status" aria-live="polite">
      {steps.map((label, i) => {
        const state = i < current ? "done" : i === current ? "now" : "later";
        return (
          <li key={label} className={`step ${state}`}>
            <span className="dot" aria-hidden="true" />
            <span className="label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
