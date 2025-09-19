import type { NextConfig } from "next";

const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '250mb', // sau cât ai nevoie
    },
  },
};

module.exports = nextConfig;
