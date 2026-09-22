import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gera `.next/standalone`: servidor Node com só as dependências que o app
  // usa de fato. É o que vai na imagem Docker (ver `Dockerfile`).
  output: "standalone",
  experimental: {
    serverActions: {
      // A criação de automação envia o script .py (até 1 MB) por Server
      // Action; o padrão de 1 MB não comporta o arquivo mais o multipart.
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
