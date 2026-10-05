import { Chip, type ChipTone } from "@/uikit";

const VALUE_TONES: Record<string, ChipTone> = {
  verified: "emerald",
  unknown: "neutral",
  unsupported: "red",
};

export function CapabilityChips({ capabilities }: { capabilities: Record<string, string> }) {
  const entries = Object.entries(capabilities);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([name, value]) => (
        <Chip key={name} tone={VALUE_TONES[value] ?? "neutral"} title={`${name}: ${value}`}>
          {name}
        </Chip>
      ))}
    </div>
  );
}
