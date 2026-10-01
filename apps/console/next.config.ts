import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Корень трассировки - репозиторий, а не каталог приложения (workspaces).
  outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
};

export default nextConfig;
