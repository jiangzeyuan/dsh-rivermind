# Add jiangzeyuan/dsh-rivermind

Add RiverMind to `fun` with one entry: `data/plugins/jiangzeyuan__dsh-rivermind.yml`.

RiverMind provides heads-up Texas Hold'em training with a human seat and one independent AI opponent, local public-action memory, configurable decision budgets, and finished-hand reviews. The repository declares `dsh.bundle`; the npm package includes prebuilt Host/client modules and its patch.

Published package: [dsh-rivermind@0.3.1](https://www.npmjs.com/package/dsh-rivermind/v/0.3.1). The package's `repository` points to the submitted repository.

Validation:
- 42 tests and `npm run release:check` pass, including package contents, Host exports and client registration.
- Installed `dsh-rivermind@0.3.0` and `@0.3.1` from the public npm registry into separate fresh DSH Web profiles using `dsh plugin --profile web add`.
- Verified the real DSH panel, BB/chip controls, saved decision budgets, a complete baseline hand, memory updates and historical review. Budgets, memory and history remain readable after restarting each isolated host. No paid model calls were used for these installation checks.
- The catalog's `readEntries` / `validateEntries` validation passes with the new entry and no duplicate.
