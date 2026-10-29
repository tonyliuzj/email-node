import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "next-env.d.ts",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Added with Next 16's lint rules to prepare code for the React Compiler, which this app doesn't use.
      // It flags the usual "load data when the page opens and show a loading state" pattern and reading the
      // dark-mode class on first render, both of which are fine as written. Every other new rule stays on.
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
