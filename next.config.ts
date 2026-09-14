import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // A criação de automação envia o script .py (até 1 MB) por Server
      // Action; o padrão de 1 MB não comporta o arquivo mais o multipart.
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
