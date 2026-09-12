# Beyond Green

Your tests passed. We check what they missed.

A post-test investigation loop that gathers and challenges evidence to detect
regressions missed by passing E2E assertions. See the
[MVP plan](Beyond%20Green%20%E2%80%94%20Hackathon%20MVP%20Plan.md).

## W&B Weave connection

Requires Node.js 24 or newer.

1. Run `npm ci`.
2. Copy `.env.example` to `.env`.
3. Create a personal API key in [W&B User Settings](https://wandb.ai/settings)
   and set `WANDB_API_KEY` in `.env`.
4. Set `WEAVE_PROJECT` to `your-team/beyond-green`, or `beyond-green` for your
   default team. Weave creates the project if it does not exist.
5. Run `npm run weave:check`.

The check uploads one synthetic connection trace, reads it back, and prints its
URL. It makes no model calls and uploads no application evidence. `.env` is
ignored by Git; keep API keys there or in your environment.

Run `npm run check` to type-check the script.

Reference: [Weave quickstart](https://docs.wandb.ai/weave/quickstart).
