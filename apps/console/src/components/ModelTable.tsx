import type { VendorCard } from "@/core/types";
import { Check, TriangleAlert } from "lucide-react";
import { Chip } from "@/ui/UIKit";

export function ModelTable({ models }: { models: VendorCard["models"] }) {
  if (models.length === 0) {
    return <p className="text-xs text-fg-faint">Модели не заданы</p>;
  }
  return (
    <table className="w-full text-xs">
      <tbody>
        {models.map((m) => (
          <tr key={m.tier} className="border-b border-line/60 last:border-0">
            <td className="whitespace-nowrap py-1 pr-2 align-top font-mono text-[11px] text-fg-faint">{m.tier}</td>
            <td className="py-1 pr-2 text-fg">{m.model}</td>
            <td className="whitespace-nowrap py-1 text-right align-top">
              <Chip tone="solid" mono>
                {m.thinkingLevel}
              </Chip>
              <span
                className={`ml-1.5 ${m.verified ? "text-accent" : "text-warning"}`}
                title={m.verified ? "маппинг подтверждён" : "не подтверждён - подтвердить у пользователя"}
              >
                {m.verified ? (
                  <Check size={12} aria-hidden className="inline" />
                ) : (
                  <TriangleAlert size={12} aria-hidden className="inline" />
                )}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
