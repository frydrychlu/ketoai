import React, { useState } from "react";
import { Cake, Weight, Ruler, Activity, Save, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { FormField } from "@/components/auth/FormField";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { ACTIVITY_LEVELS, type ActivityLevel, type HealthProfile } from "@/types";

const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: "Sedentary — little or no exercise",
  light: "Light — exercise 1–3 days/week",
  moderate: "Moderate — exercise 3–5 days/week",
  very: "Very active — hard exercise 6–7 days/week",
  extra: "Extra active — very hard exercise / physical job",
};

// Range bounds mirror the Zod schema in /api/profile and the DB CHECK constraints.
const RANGES = {
  age: { min: 13, max: 120 },
  weight_kg: { min: 20, max: 500 },
  height_cm: { min: 50, max: 250 },
} as const;

type NumericField = keyof typeof RANGES;

interface Props {
  initial: HealthProfile | null;
  serverError?: string | null;
  saved?: boolean;
}

function numToStr(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

export default function ProfileForm({ initial, serverError, saved }: Props) {
  const [age, setAge] = useState(numToStr(initial?.age));
  const [weight, setWeight] = useState(numToStr(initial?.weight_kg));
  const [height, setHeight] = useState(numToStr(initial?.height_cm));
  const [activity, setActivity] = useState<string>(initial?.activity_level ?? "");
  const [goals, setGoals] = useState(initial?.health_goals ?? "");
  const [errors, setErrors] = useState<Partial<Record<NumericField, string>>>({});

  // Optional field: blank is valid. A non-blank value must be a number within range.
  function rangeError(field: NumericField, raw: string): string | undefined {
    const trimmed = raw.trim();
    if (trimmed === "") return undefined;
    const value = Number(trimmed);
    const { min, max } = RANGES[field];
    if (Number.isNaN(value)) return "Enter a number";
    if (field === "age" && !Number.isInteger(value)) return "Enter a whole number";
    if (value < min || value > max) return `Must be between ${min} and ${max}`;
    return undefined;
  }

  function validate(): boolean {
    const next: Partial<Record<NumericField, string>> = {
      age: rangeError("age", age),
      weight_kg: rangeError("weight_kg", weight),
      height_cm: rangeError("height_cm", height),
    };
    setErrors(next);
    return !next.age && !next.weight_kg && !next.height_cm;
  }

  // Client-side range validation blocks submit so an out-of-range value never reaches
  // the server (whose error redirect would otherwise discard the user's typed input).
  function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      event.preventDefault();
    }
  }

  function clearError(field: NumericField) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  const selectClass = cn(
    "w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 pl-10 text-white",
    "transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none",
  );

  return (
    <form method="POST" action="/api/profile" className="space-y-4" onSubmit={handleSubmit} noValidate>
      {saved && (
        <p className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-900/30 px-3 py-2 text-sm text-green-300">
          <CircleCheck className="size-4 shrink-0" />
          Profile saved.
        </p>
      )}

      <ServerError message={serverError} />

      <FormField
        id="age"
        name="age"
        type="number"
        label="Age"
        value={age}
        onChange={(v) => {
          setAge(v);
          clearError("age");
        }}
        placeholder="e.g. 40"
        error={errors.age}
        icon={<Cake className="size-4" />}
      />

      <FormField
        id="weight_kg"
        name="weight_kg"
        type="number"
        label="Weight (kg)"
        value={weight}
        onChange={(v) => {
          setWeight(v);
          clearError("weight_kg");
        }}
        placeholder="e.g. 82"
        error={errors.weight_kg}
        icon={<Weight className="size-4" />}
      />

      <FormField
        id="height_cm"
        name="height_cm"
        type="number"
        label="Height (cm)"
        value={height}
        onChange={(v) => {
          setHeight(v);
          clearError("height_cm");
        }}
        placeholder="e.g. 180"
        error={errors.height_cm}
        icon={<Ruler className="size-4" />}
      />

      <div>
        <label htmlFor="activity_level" className="mb-1 block text-sm text-blue-100/80">
          Activity level
        </label>
        <div className="relative">
          <span className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/40">
            <Activity className="size-4" />
          </span>
          <select
            id="activity_level"
            name="activity_level"
            value={activity}
            onChange={(e) => {
              setActivity(e.target.value);
            }}
            className={selectClass}
          >
            <option value="" className="bg-slate-800">
              —
            </option>
            {ACTIVITY_LEVELS.map((level) => (
              <option key={level} value={level} className="bg-slate-800">
                {ACTIVITY_LABELS[level]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="health_goals" className="mb-1 block text-sm text-blue-100/80">
          Health goals
        </label>
        <textarea
          id="health_goals"
          name="health_goals"
          value={goals}
          onChange={(e) => {
            setGoals(e.target.value);
          }}
          rows={4}
          placeholder="What are you aiming for? (e.g. lower GKI, lose fat, maintain ketosis)"
          className={cn(
            "w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40",
            "transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none",
          )}
        />
      </div>

      <SubmitButton pendingText="Saving..." icon={<Save className="size-4" />}>
        Save profile
      </SubmitButton>
    </form>
  );
}
