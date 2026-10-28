import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Корень трассировки - репозиторий, а не каталог приложения (workspaces).
  outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
  // TS-исходники workspace-пакета Guardrails компилируются Next.
  transpilePackages: ["@harness/guardrails"],
  // Консоль открывают и по http://127.0.0.1:3000: без записи в списке Next
  // отклоняет Origin HMR-соединения ("Unauthorized"), гидратация не стартует
  // и интерфейс теряет интерактивность (клики, React Flow).
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
