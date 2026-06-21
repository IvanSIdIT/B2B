import { Generator } from "@tanstack/router-generator";

const config = {
  routesDirectory: "./src/routes",
  generatedRouteTree: "./src/routeTree.gen.ts",
  target: "react",
  disableLogging: false,
  indexToken: "index",
  routeToken: "route",
  routeFileIgnorePrefix: "-",
  quoteStyle: "single",
  semicolons: false,
  routeTreeFileHeader: [
    "/* eslint-disable */",
    "// @ts-nocheck",
    "// noinspection JSUnusedGlobalSymbols",
  ],
  disableTypes: false,
  addExtensions: false,
  enableRouteTreeFormatting: true,
  tmpDir: "",
  importRoutesUsingAbsolutePaths: false,
};

const generator = new Generator({ config, root: process.cwd() });
await generator.run();
console.log("routeTree.gen.ts updated");
