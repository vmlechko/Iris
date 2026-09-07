import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  // The service worker is not built in development, so leaving registration on
  // only produces a failed fetch in the console every reload.
  disable: process.env.NODE_ENV === "development",
  // Note: This is only an example. If you use Pages Router,
  // use something else that works, such as "service-worker/index.ts".
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
});

export default withSerwist({
  // Your Next.js config
});