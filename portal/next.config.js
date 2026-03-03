module.exports = {
  output: "standalone",
  async redirects() {
    return [
      {
        source: "/agent",
        destination: "/agent/",
        permanent: true,
      },
    ];
  },
};
